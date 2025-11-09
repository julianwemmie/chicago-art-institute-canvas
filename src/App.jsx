import { useCallback, useEffect, useRef, useState } from 'react';
import ArtworkGrid from './components/ArtworkGrid.jsx';
import ArtworkModal from './components/ArtworkModal.jsx';
import { buildWorldPlacements } from './lib/layout.js';
import {
  CHUNK_COLUMNS,
  CHUNK_TILE_LIMIT,
  DEFAULT_TOTAL_PAGES,
  chunkBoundsFromWorld,
  chunkKey,
  encodeChunkIndex,
  resolvePageNumber,
} from './lib/chunks.js';
import { fetchArtworksPage } from './lib/api.js';

export default function App() {
  const [placements, setPlacements] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activeRequests, setActiveRequests] = useState(0);
  const [error, setError] = useState(null);
  const totalPagesRef = useRef(DEFAULT_TOTAL_PAGES);
  const chunkStoreRef = useRef(new Map());
  const inflightChunksRef = useRef(new Set());

  const recomputePlacements = useCallback(() => {
    const readyChunks = Array.from(chunkStoreRef.current.values()).filter(
      (chunk) => chunk.status === 'ready' && chunk.artworks?.length
    );
    setPlacements(buildWorldPlacements(readyChunks, { columnsPerChunk: CHUNK_COLUMNS }));
  }, []);

  const fetchChunk = useCallback(async (coordinates) => {
    const index = encodeChunkIndex(coordinates.x, coordinates.y);
    const page = resolvePageNumber(index, totalPagesRef.current);
    const { artworks, totalPages } = await fetchArtworksPage(page, CHUNK_TILE_LIMIT);

    if (Number.isFinite(totalPages)) {
      totalPagesRef.current = totalPages;
    }

    return artworks;
  }, []);

  const ensureChunkLoaded = useCallback(
    async (coordinates) => {
      const key = chunkKey(coordinates);
      const existing = chunkStoreRef.current.get(key);
      if (existing?.status === 'ready' || inflightChunksRef.current.has(key)) {
        return;
      }

      inflightChunksRef.current.add(key);
      setActiveRequests((count) => count + 1);
      setError(null);

      try {
        const artworks = await fetchChunk(coordinates);
        chunkStoreRef.current.set(key, {
          status: 'ready',
          artworks: artworks.slice(0, CHUNK_TILE_LIMIT),
          coordinates,
        });
        recomputePlacements();
      } catch (err) {
        chunkStoreRef.current.set(key, { status: 'error', coordinates });
        setError(err.message);
      } finally {
        inflightChunksRef.current.delete(key);
        setActiveRequests((count) => Math.max(0, count - 1));
      }
    },
    [fetchChunk, recomputePlacements]
  );

  useEffect(() => {
    ensureChunkLoaded({ x: 0, y: 0 });
  }, [ensureChunkLoaded]);

  const requestChunksForBounds = useCallback(
    (bounds) => {
      if (!bounds) {
        return;
      }

      const targets = chunkBoundsFromWorld(bounds);
      targets.forEach((coordinates) => {
        ensureChunkLoaded(coordinates);
      });
    },
    [ensureChunkLoaded]
  );

  const handleViewportChange = useCallback(
    (worldBounds) => {
      if (!worldBounds) {
        return;
      }
      requestChunksForBounds(worldBounds);
    },
    [requestChunksForBounds]
  );

  const showEmptyState = placements.length === 0 && activeRequests === 0 && !error;
  const showError = Boolean(error);
  const showLoading = activeRequests > 0;

  return (
    <div className="app">
      <ArtworkGrid
        placements={placements}
        onSelect={(artwork) => setSelected(artwork)}
        onViewportChange={handleViewportChange}
      />

      <div className="app__chrome" aria-live="polite" aria-atomic="true">
        <header className="app__header">
          <h1>Art Institute Explorer</h1>
          <p>Scroll through an endless wall of art and tap a tile for details.</p>
        </header>

        <div className="app__status-stack">
          {showError && (
            <div className="status status--error">
              <p>There was a problem loading artwork. Please try again.</p>
              <p className="status__details">{error}</p>
            </div>
          )}

          {showEmptyState && (
            <div className="status">
              <p>No artwork found right now. Please try again later.</p>
            </div>
          )}

          {showLoading && (
            <div className="status">
              <p>Loading more artwork…</p>
            </div>
          )}
        </div>
      </div>

      <ArtworkModal
        artwork={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

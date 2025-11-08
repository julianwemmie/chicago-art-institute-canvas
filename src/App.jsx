import { useCallback, useEffect, useMemo, useState } from 'react';
import ArtworkGrid from './components/ArtworkGrid.jsx';
import ArtworkModal from './components/ArtworkModal.jsx';

const PAGE_SIZE = 12;
const COLUMN_WIDTH = 320;
const COLUMN_GAP = 24;
const ROW_GAP = 24;
const MIN_TILE_HEIGHT = 180;
const MAX_TILE_HEIGHT = 520;
const MAX_COLUMNS = 6;
const MIN_COLUMNS = 3;
const API_URL = 'https://api.artic.edu/api/v1/artworks';
const FIELDS = ['id', 'title', 'image_id', 'artist_display', 'date_display', 'thumbnail', 'medium_display'];

const buildImageUrl = (imageId, size = 400) =>
  imageId ? `https://www.artic.edu/iiif/2/${imageId}/full/${size},/0/default.jpg` : null;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function buildDeterministicPlacements(artworks) {
  if (!artworks.length) {
    return [];
  }

  const columns = clamp(Math.round(Math.sqrt(artworks.length)), MIN_COLUMNS, MAX_COLUMNS);
  const columnHeights = new Array(columns).fill(0);
  const strideX = COLUMN_WIDTH + COLUMN_GAP;

  return artworks.map((artwork, index) => {
    const ratio =
      artwork.thumbnailHeight && artwork.thumbnailWidth
        ? artwork.thumbnailHeight / artwork.thumbnailWidth
        : 4 / 5;
    const tileHeight = clamp(Math.round(COLUMN_WIDTH * ratio), MIN_TILE_HEIGHT, MAX_TILE_HEIGHT);

    let targetColumn = 0;
    let lowest = columnHeights[0];
    for (let col = 1; col < columns; col += 1) {
      if (columnHeights[col] < lowest) {
        lowest = columnHeights[col];
        targetColumn = col;
      }
    }

    const x = targetColumn * strideX;
    const y = columnHeights[targetColumn];

    columnHeights[targetColumn] += tileHeight + ROW_GAP;

    return {
      id: `${artwork.id}-${index}`,
      artwork,
      width: COLUMN_WIDTH,
      height: tileHeight,
      x,
      y,
      column: targetColumn,
    };
  });
}

export default function App() {
  const [artworks, setArtworks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const fetchArtworks = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const url = new URL(API_URL);
      // @ts-ignore
      url.searchParams.set('limit', PAGE_SIZE);
      url.searchParams.set('fields', FIELDS.join(','));
      url.searchParams.set('page', '1');

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const data = await response.json();
      const nextArtworks = data.data
        .filter((item) => item.image_id)
        .map((item) => {
          const thumbnailWidth = item.thumbnail?.width ?? null;
          const thumbnailHeight = item.thumbnail?.height ?? null;

          return {
            id: item.id,
            title: item.title,
            artist: item.artist_display || 'Unknown Artist',
            date: item.date_display || 'Date unknown',
            medium: item.medium_display || 'Medium unknown',
            imageId: item.image_id,
            thumbnail: buildImageUrl(item.image_id, 400),
            large: buildImageUrl(item.image_id, 800),
            thumbnailWidth,
            thumbnailHeight,
          };
        });

      setArtworks(nextArtworks.slice(0, PAGE_SIZE));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArtworks();
  }, [fetchArtworks]);

  const placements = useMemo(() => buildDeterministicPlacements(artworks), [artworks]);

  const showEmptyState = !loading && !error && artworks.length === 0;
  const showError = Boolean(error);

  return (
    <div className="app">
      <ArtworkGrid
        placements={placements}
        onSelect={(artwork) => setSelected(artwork)}
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

          {loading && (
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

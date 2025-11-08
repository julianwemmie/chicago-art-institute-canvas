import { useCallback, useEffect, useRef, useState } from 'react';
import ArtworkGrid from './components/ArtworkGrid.jsx';
import ArtworkModal from './components/ArtworkModal.jsx';

const COLUMN_WIDTH = 320;
const COLUMN_GAP = 24;
const ROW_GAP = 24;
const MIN_TILE_HEIGHT = 180;
const MAX_TILE_HEIGHT = 520;
const MAX_COLUMNS = 6;
const MIN_COLUMNS = 3;
const CHUNK_COLUMNS = 4;
const CHUNK_ROWS = 3;
const CHUNK_TILE_LIMIT = CHUNK_COLUMNS * CHUNK_ROWS;
const CHUNK_STRIDE_X = CHUNK_COLUMNS * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_GAP;
const CHUNK_STRIDE_Y = CHUNK_ROWS * (MAX_TILE_HEIGHT + ROW_GAP) + ROW_GAP;
const VIEW_LOAD_BUFFER = Math.max(CHUNK_STRIDE_X, CHUNK_STRIDE_Y);
const DEFAULT_TOTAL_PAGES = 8000;
const API_URL = 'https://api.artic.edu/api/v1/artworks';
const FIELDS = ['id', 'title', 'image_id', 'artist_display', 'date_display', 'thumbnail', 'medium_display'];

const buildImageUrl = (imageId, size = 400) =>
  imageId ? `https://www.artic.edu/iiif/2/${imageId}/full/${size},/0/default.jpg` : null;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const chunkKey = (x, y) => `${x}:${y}`;

const encodeSignedInt = (value) => (value >= 0 ? value * 2 : -value * 2 - 1);

const encodeChunkIndex = (x, y) => {
  const ax = encodeSignedInt(x);
  const ay = encodeSignedInt(y);
  const sum = ax + ay;
  return (sum * (sum + 1)) / 2 + ay;
};

const resolvePageNumber = (index, totalPages) => {
  const safeTotal = Math.max(1, totalPages);
  const bounded = ((index % safeTotal) + safeTotal) % safeTotal;
  return bounded + 1;
};

const chunkBoundsFromWorld = (bounds) => {
  const expanded = {
    left: bounds.left - VIEW_LOAD_BUFFER,
    right: bounds.right + VIEW_LOAD_BUFFER,
    top: bounds.top - VIEW_LOAD_BUFFER,
    bottom: bounds.bottom + VIEW_LOAD_BUFFER,
  };
  const minX = Math.floor(expanded.left / CHUNK_STRIDE_X);
  const maxX = Math.floor(expanded.right / CHUNK_STRIDE_X);
  const minY = Math.floor(expanded.top / CHUNK_STRIDE_Y);
  const maxY = Math.floor(expanded.bottom / CHUNK_STRIDE_Y);

  const result = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      result.push({ x, y });
    }
  }
  return result;
};

function buildDeterministicPlacements(artworks, options = {}) {
  const {
    columns: forcedColumns = null,
    startIndex = 0,
    startHeights = null,
  } = options;

  if (!artworks.length) {
    return {
      placements: [],
      columnHeights: startHeights ? [...startHeights] : [],
    };
  }

  const columns =
    forcedColumns != null
      ? clamp(forcedColumns, 1, MAX_COLUMNS)
      : clamp(Math.round(Math.sqrt(artworks.length)), MIN_COLUMNS, MAX_COLUMNS);
  const columnHeights = Array.from({ length: columns }, (_, columnIndex) =>
    startHeights?.[columnIndex] ?? 0
  );
  const strideX = COLUMN_WIDTH + COLUMN_GAP;
  const placements = [];

  artworks.forEach((artwork, index) => {
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

    columnHeights[targetColumn] = y + tileHeight + ROW_GAP;

    placements.push({
      id: `${artwork.id}-${startIndex + index}`,
      artwork,
      width: COLUMN_WIDTH,
      height: tileHeight,
      x,
      y,
      columnIndex: targetColumn,
    });
  });

  return {
    placements,
    columnHeights,
  };
}

export default function App() {
  const [placements, setPlacements] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activeRequests, setActiveRequests] = useState(0);
  const [error, setError] = useState(null);
  const totalPagesRef = useRef(DEFAULT_TOTAL_PAGES);
  const chunkStoreRef = useRef(new Map());
  const inflightChunksRef = useRef(new Set());

  const recomputePlacements = useCallback(() => {
    const readyChunks = [];
    chunkStoreRef.current.forEach((chunk) => {
      if (chunk.status === 'ready' && chunk.artworks?.length) {
        readyChunks.push(chunk);
      }
    });

    if (readyChunks.length === 0) {
      setPlacements([]);
      return;
    }

    const columnStride = COLUMN_WIDTH + COLUMN_GAP;
    const worldPlacements = [];

    const groups = new Map();
    readyChunks.forEach((chunk) => {
      const x = chunk.coordinates.x;
      if (!groups.has(x)) {
        groups.set(x, { positives: [], negatives: [] });
      }
      const group = groups.get(x);
      if (chunk.coordinates.y >= 0) {
        group.positives.push(chunk);
      } else {
        group.negatives.push(chunk);
      }
    });

    groups.forEach((group, chunkX) => {
      const baseColumnIndex = chunkX * CHUNK_COLUMNS;
      const worldXBase = baseColumnIndex * columnStride;

      const downwardHeights = new Array(CHUNK_COLUMNS).fill(0);
      group.positives
        .sort((a, b) => a.coordinates.y - b.coordinates.y || a.coordinates.x - b.coordinates.x)
        .forEach((chunk) => {
          const { placements: localPlacements, columnHeights } = buildDeterministicPlacements(chunk.artworks, {
            columns: CHUNK_COLUMNS,
            startHeights: downwardHeights,
          });
          localPlacements.forEach((placement) => {
            const worldX = worldXBase + placement.columnIndex * columnStride;
            const worldY = placement.y;
            worldPlacements.push({
              ...placement,
              id: `${chunk.coordinates.x}:${chunk.coordinates.y}:${placement.id}`,
              x: worldX,
              y: worldY,
            });
          });
          columnHeights.forEach((height, index) => {
            downwardHeights[index] = height;
          });
        });

      const upwardHeights = new Array(CHUNK_COLUMNS).fill(0);
      group.negatives
        .sort((a, b) => b.coordinates.y - a.coordinates.y || a.coordinates.x - b.coordinates.x)
        .forEach((chunk) => {
          const { placements: localPlacements, columnHeights } = buildDeterministicPlacements(chunk.artworks, {
            columns: CHUNK_COLUMNS,
            startHeights: upwardHeights,
          });
          localPlacements.forEach((placement) => {
            const worldX = worldXBase + placement.columnIndex * columnStride;
            const worldY = -(placement.y + placement.height);
            worldPlacements.push({
              ...placement,
              id: `${chunk.coordinates.x}:${chunk.coordinates.y}:${placement.id}`,
              x: worldX,
              y: worldY,
            });
          });
          columnHeights.forEach((height, index) => {
            upwardHeights[index] = height;
          });
        });
    });

    setPlacements(worldPlacements);
  }, []);

  const fetchChunk = useCallback(async (coordinates) => {
    const index = encodeChunkIndex(coordinates.x, coordinates.y);
    const page = resolvePageNumber(index, totalPagesRef.current);
    const url = new URL(API_URL);
    // @ts-ignore
    url.searchParams.set('limit', CHUNK_TILE_LIMIT);
    url.searchParams.set('fields', FIELDS.join(','));
    url.searchParams.set('page', String(page));

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    const data = await response.json();
    if (Number.isFinite(data?.pagination?.total_pages)) {
      totalPagesRef.current = data.pagination.total_pages;
    }
    return data.data
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
  }, []);

  const ensureChunkLoaded = useCallback(
    async (coordinates) => {
      const key = chunkKey(coordinates.x, coordinates.y);
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

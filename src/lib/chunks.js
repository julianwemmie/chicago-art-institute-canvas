import {
  COLUMN_GAP,
  COLUMN_WIDTH,
  MAX_TILE_HEIGHT,
  ROW_GAP,
} from './layout.js';

const CHUNK_COLUMNS = 4;
const CHUNK_ROWS = 3;
const CHUNK_TILE_LIMIT = CHUNK_COLUMNS * CHUNK_ROWS;
const CHUNK_STRIDE_X = CHUNK_COLUMNS * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_GAP;
const CHUNK_STRIDE_Y = CHUNK_ROWS * (MAX_TILE_HEIGHT + ROW_GAP) + ROW_GAP;
const VIEW_LOAD_BUFFER = Math.max(CHUNK_STRIDE_X, CHUNK_STRIDE_Y);
const DEFAULT_TOTAL_PAGES = 8000;

const chunkKey = ({ x, y }) => `${x}:${y}`;

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

export {
  CHUNK_COLUMNS,
  CHUNK_ROWS,
  CHUNK_STRIDE_X,
  CHUNK_STRIDE_Y,
  CHUNK_TILE_LIMIT,
  DEFAULT_TOTAL_PAGES,
  VIEW_LOAD_BUFFER,
  chunkBoundsFromWorld,
  chunkKey,
  encodeChunkIndex,
  resolvePageNumber,
};

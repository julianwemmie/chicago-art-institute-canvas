export const TILE_SIZE = 256;
export const SECTOR_SIZE = 16;
export const MAX_SECTORS = 200;
export const PREFETCH_SECTORS = 2;

// Chrome (and most Blink-based browsers) clamp scroll offsets to ~16 million
// device pixels. A 1,000,000² logical grid would require scroll offsets well
// beyond that limit, which caused the initial centering logic to snap to the
// maximum scroll range (the bottom-right corner). Clamp the usable origin to a
// safe window so the grid can still open in the middle while exposing tens of
// thousands of tiles in every direction.
const MAX_SCROLL_RANGE_PX = 16_000_000;
const MAX_ORIGIN_INDEX = Math.floor((MAX_SCROLL_RANGE_PX / TILE_SIZE - 1) / 2);

export const ORIGIN_INDEX = Math.min(500_000, MAX_ORIGIN_INDEX);
export const GRID_DIMENSION = ORIGIN_INDEX * 2 + 1;
export const GLOBAL_SEED = 0x1f4b5;
export const IIIF_IMAGE_SIZE = '400,';
export const FETCH_DEBOUNCE_MS = 300;

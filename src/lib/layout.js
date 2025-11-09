const COLUMN_WIDTH = 320;
const COLUMN_GAP = 24;
const ROW_GAP = 24;
const MIN_TILE_HEIGHT = 180;
const MAX_TILE_HEIGHT = 520;
const MAX_COLUMNS = 6;
const MIN_COLUMNS = 3;
const COLUMN_STRIDE = COLUMN_WIDTH + COLUMN_GAP;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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

    const x = targetColumn * COLUMN_STRIDE;
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

function buildWorldPlacements(chunks, options = {}) {
  if (!chunks?.length) {
    return [];
  }

  const columnsPerChunk = options.columnsPerChunk ?? 1;
  const columnStride = options.columnStride ?? COLUMN_STRIDE;
  const groups = new Map();

  chunks.forEach((chunk) => {
    const { coordinates } = chunk;
    if (!coordinates) {
      return;
    }
    if (!groups.has(coordinates.x)) {
      groups.set(coordinates.x, { positives: [], negatives: [] });
    }
    const bucket = coordinates.y >= 0 ? 'positives' : 'negatives';
    groups.get(coordinates.x)[bucket].push(chunk);
  });

  const worldPlacements = [];

  groups.forEach((group, chunkX) => {
    const worldXBase = chunkX * columnsPerChunk * columnStride;

    const layChunks = (chunksToLay, heights, invertY = false) => {
      chunksToLay.forEach((chunk) => {
        const { placements, columnHeights } = buildDeterministicPlacements(chunk.artworks, {
          columns: columnsPerChunk,
          startHeights: heights,
        });

        placements.forEach((placement) => {
          const worldX = worldXBase + placement.columnIndex * columnStride;
          const worldY = invertY ? -(placement.y + placement.height) : placement.y;
          worldPlacements.push({
            ...placement,
            id: `${chunk.coordinates.x}:${chunk.coordinates.y}:${placement.id}`,
            x: worldX,
            y: worldY,
          });
        });

        columnHeights.forEach((height, index) => {
          heights[index] = height;
        });
      });
    };

    const downwardHeights = new Array(columnsPerChunk).fill(0);
    const ascending = [...group.positives].sort(
      (a, b) => a.coordinates.y - b.coordinates.y || a.coordinates.x - b.coordinates.x
    );
    layChunks(ascending, downwardHeights, false);

    const upwardHeights = new Array(columnsPerChunk).fill(0);
    const descending = [...group.negatives].sort(
      (a, b) => b.coordinates.y - a.coordinates.y || a.coordinates.x - b.coordinates.x
    );
    layChunks(descending, upwardHeights, true);
  });

  return worldPlacements;
}

export {
  COLUMN_GAP,
  COLUMN_STRIDE,
  COLUMN_WIDTH,
  MAX_COLUMNS,
  MAX_TILE_HEIGHT,
  MIN_COLUMNS,
  MIN_TILE_HEIGHT,
  ROW_GAP,
  buildDeterministicPlacements,
  buildWorldPlacements,
  clamp,
};

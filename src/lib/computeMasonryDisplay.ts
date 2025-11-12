import type { ReactNode } from "react";

export type MasonryImage = {
  id?: string | number;
  width?: number;
  height?: number;
  content: ReactNode;
} & Partial<Pick<PlacedItem, "x" | "y" | "w" | "h" | "col">>;

export type Bounds = { x: number; y: number; width: number; height: number };

export type PlacedItem = {
  id: string | number;
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
  content: ReactNode;
};

export type MasonryResult = {
  placed: PlacedItem[];
  state: LayoutState;
  addedIds: Array<string | number>;
  reusedIds: Array<string | number>;
};

export type LayoutState = {
  columnWidth: number;
  columnGap: number;
  x0: number;
  columns: Map<number, ColumnState>;
  seenIds: Set<string | number>;
};

export type ColumnState = {
  x: number;
  items: PlacedItem[];
  cursorTop: number;
  cursorBottom: number;
};

const MAX_IMAGE_ATTEMPTS = 4096;
const EPSILON = 1e-3;

export function computeMasonryDisplay(
  images: MasonryImage[],
  bounds: Bounds,
  prevBounds: Bounds | null,
  getImage: () => MasonryImage,
  options?: {
    columnWidth: number;
    columnGap: number;
    x0?: number;
    sideBufferCols?: number;
    preloadY?: number;
  }
): MasonryResult {
  if (!options) {
    throw new Error("options are required");
  }

  const columnWidth = options.columnWidth;
  const columnGap = options.columnGap;
  if (!Number.isFinite(columnWidth) || columnWidth <= 0) {
    throw new Error("columnWidth must be > 0");
  }
  if (!Number.isFinite(columnGap) || columnGap < 0) {
    throw new Error("columnGap must be >= 0");
  }

  const x0 = options.x0 ?? 0;
  const sideBufferCols = options.sideBufferCols ?? 1;
  const preloadY = options.preloadY ?? 0;
  const dx = prevBounds ? bounds.x - prevBounds.x : 0;
  const dy = prevBounds ? bounds.y - prevBounds.y : 0;

  const state: LayoutState = {
    columnWidth,
    columnGap,
    x0,
    columns: new Map(),
    seenIds: new Set(),
  };

  const addedSet = new Set<string | number>();
  const acquireImage = createAcquireImage(getImage, state);

  seedColumnsFromImages(images, state);

  const colIndices = columnsIn(bounds, x0, columnWidth, columnGap, sideBufferCols);
  const colSet = new Set(colIndices);
  const targetTop = bounds.y - preloadY;
  const targetBottom = bounds.y + bounds.height + preloadY;

  const newColumns: number[] = [];
  for (const idx of colIndices) {
    const col = ensureColumn(state, idx);
    if (col.items.length === 0) {
      col.cursorTop = bounds.y;
      col.cursorBottom = bounds.y;
      newColumns.push(idx);
    } else {
      col.cursorTop = columnTopY(col);
      col.cursorBottom = columnBottomY(col);
    }
  }

  const fillTop = (colIndex: number) => {
    const col = state.columns.get(colIndex);
    if (!col) return;
    while (columnTopY(col) > targetTop + EPSILON) {
      const placed = placeAbove(state, colIndex, acquireImage());
      addedSet.add(placed.id);
    }
  };

  const fillBottom = (colIndex: number) => {
    const col = state.columns.get(colIndex);
    if (!col) return;
    while (columnBottomY(col) < targetBottom - EPSILON) {
      const placed = placeBelow(state, colIndex, acquireImage());
      addedSet.add(placed.id);
    }
  };

  for (const idx of newColumns) {
    const col = state.columns.get(idx);
    if (!col) continue;
    if (columnBottomY(col) === -Infinity) {
      const placed = placeBelow(state, idx, acquireImage());
      addedSet.add(placed.id);
    }
    fillTop(idx);
    fillBottom(idx);
  }

  if (dy > 0) {
    for (const idx of colIndices) fillTop(idx);
  } else if (dy < 0) {
    for (const idx of colIndices) fillBottom(idx);
  } else {
    for (const idx of colIndices) fillTop(idx);
    if (dx !== 0 || newColumns.length === 0) {
      for (const idx of colIndices) fillBottom(idx);
    }
  }

  for (const idx of colIndices) {
    healColumnGaps(state, idx, bounds, dy, dx, acquireImage, addedSet);
  }

  const expandedBounds = expandBoundsY(bounds, preloadY);
  const placed = collectPlaced(state, expandedBounds, colSet);

  const addedIds: Array<string | number> = [];
  const reusedIds: Array<string | number> = [];
  for (const item of placed) {
    if (addedSet.has(item.id)) {
      addedIds.push(item.id);
    } else {
      reusedIds.push(item.id);
    }
  }

  return { placed, state, addedIds, reusedIds };
}

/** Build a deterministic image supplier that enforces uniqueness and valid sizes. */
function createAcquireImage(
  getImage: () => MasonryImage,
  state: LayoutState
): () => MasonryImage {
  let autoId = 0;
  return () => {
    for (let attempt = 0; attempt < MAX_IMAGE_ATTEMPTS; attempt += 1) {
      const candidate = getImage();
      if (!candidate) continue;
      const id = candidate.id ?? `__masonry_generated_${autoId++}`;
      if (state.seenIds.has(id)) {
        continue;
      }
      if (
        !Number.isFinite(candidate.width) ||
        !Number.isFinite(candidate.height) ||
        candidate.width! <= 0 ||
        candidate.height! <= 0
      ) {
        throw new Error("getImage() must return width and height > 0");
      }
      const normalized: MasonryImage = { ...candidate, id };
      state.seenIds.add(id);
      return normalized;
    }
    throw new Error("getImage() failed to provide a unique image");
  };
}

/** Derive the column index whose span includes x. */
function getColumnIndexForX(x0: number, cw: number, gap: number, x: number): number {
  const span = cw + gap;
  if (span === 0) return 0;
  return Math.round((x - x0) / span);
}

/** Compute all column indices intersecting the expanded bounds. */
function columnsIn(
  bounds: Bounds,
  x0: number,
  cw: number,
  gap: number,
  sideBufferCols: number
): number[] {
  const span = cw + gap;
  const left = bounds.x - sideBufferCols * span;
  const right = bounds.x + bounds.width + sideBufferCols * span;
  const start = Math.floor((left - x0) / span);
  const end = Math.floor((right - x0) / span);
  const result: number[] = [];
  for (let i = start; i <= end; i += 1) {
    result.push(i);
  }
  return result;
}

/** Ensure a ColumnState exists for index i. */
function ensureColumn(state: LayoutState, i: number): ColumnState {
  const existing = state.columns.get(i);
  if (existing) return existing;
  const col: ColumnState = {
    x: state.x0 + i * (state.columnWidth + state.columnGap),
    items: [],
    cursorTop: 0,
    cursorBottom: 0,
  };
  state.columns.set(i, col);
  return col;
}

/** Scale an image to the column width. */
function scaleSize(img: MasonryImage, cw: number): { w: number; h: number } {
  if (
    !Number.isFinite(img.width) ||
    !Number.isFinite(img.height) ||
    img.width! <= 0 ||
    img.height! <= 0
  ) {
    throw new Error("Images must include width and height to scale");
  }
  const h = Math.max(1, Math.round((cw * img.height!) / img.width!));
  return { w: cw, h };
}

/** Smallest Y in column or +Infinity when empty. */
function columnTopY(col: ColumnState): number {
  return col.items.length ? col.items[0].y : Infinity;
}

/** Largest y+h in column or -Infinity when empty. */
function columnBottomY(col: ColumnState): number {
  if (!col.items.length) return -Infinity;
  const last = col.items[col.items.length - 1];
  return last.y + last.h;
}

/** Place a new item above the current top of the column. */
function placeAbove(state: LayoutState, colIndex: number, img: MasonryImage): PlacedItem {
  const col = ensureColumn(state, colIndex);
  const { w, h } = scaleSize(img, state.columnWidth);
  const topY = columnTopY(col);
  const y = Number.isFinite(topY) ? topY - h : col.cursorTop;
  const placed: PlacedItem = {
    id: img.id!,
    x: col.x,
    y,
    w,
    h,
    col: colIndex,
    content: img.content,
  };
  col.items.unshift(placed);
  updateColumnCursors(col);
  return placed;
}

/** Place a new item below the current bottom of the column. */
function placeBelow(state: LayoutState, colIndex: number, img: MasonryImage): PlacedItem {
  const col = ensureColumn(state, colIndex);
  const { w, h } = scaleSize(img, state.columnWidth);
  const bottomY = columnBottomY(col);
  const y = Number.isFinite(bottomY) ? bottomY : col.cursorBottom;
  const placed: PlacedItem = {
    id: img.id!,
    x: col.x,
    y,
    w,
    h,
    col: colIndex,
    content: img.content,
  };
  col.items.push(placed);
  updateColumnCursors(col);
  return placed;
}

type VisibleGap = {
  topItem?: PlacedItem;
  bottomItem?: PlacedItem;
  topIndex: number;
  bottomIndex: number;
  gapPx: number;
};

/** Gap details between visible top/bottom items. */
function visibleGap(col: ColumnState, bounds: Bounds): VisibleGap {
  const topLimit = bounds.y;
  const bottomLimit = bounds.y + bounds.height;
  const items = col.items;
  if (!items.length) {
    return { topIndex: -1, bottomIndex: -1, gapPx: bottomLimit - topLimit };
  }
  const topIndex = findFirstItemWithBottomAtLeast(items, topLimit);
  const bottomIndex = findLastItemWithTopAtMost(items, bottomLimit);
  const topItem = topIndex >= 0 ? items[topIndex] : undefined;
  const bottomItem = bottomIndex >= 0 ? items[bottomIndex] : undefined;
  if (!topItem || !bottomItem || topIndex > bottomIndex) {
    return { topItem, bottomItem, topIndex, bottomIndex, gapPx: bottomLimit - topLimit };
  }
  const gapPx = bottomItem.y - (topItem.y + topItem.h);
  return { topItem, bottomItem, topIndex, bottomIndex, gapPx };
}

/** Simple Y-span overlap test. */
function intersectsY(item: PlacedItem, yTop: number, yBottom: number): boolean {
  const itemBottom = item.y + item.h;
  return !(itemBottom < yTop || item.y > yBottom);
}

/** Collect placed items within the expanded bounds and requested columns. */
function collectPlaced(
  state: LayoutState,
  bounds: Bounds,
  allowedColumns: Set<number>
): PlacedItem[] {
  const yTop = bounds.y;
  const yBottom = bounds.y + bounds.height;
  const gathered: PlacedItem[] = [];
  for (const index of allowedColumns) {
    const col = state.columns.get(index);
    if (!col) continue;
    for (const item of col.items) {
      if (intersectsY(item, yTop, yBottom)) {
        gathered.push(item);
      }
    }
  }
  return gathered.sort((a, b) => (a.col === b.col ? a.y - b.y : a.col - b.col));
}

/** Seed existing columns from provided images that already carry positions. */
function seedColumnsFromImages(images: MasonryImage[], state: LayoutState): void {
  let autoId = 0;
  for (const img of images) {
    if (!img) continue;
    const hasCoords = typeof img.x === "number" && typeof img.y === "number";
    if (!hasCoords) continue;
    const id = img.id ?? `__seed_${autoId++}`;
    if (state.seenIds.has(id)) continue;
    const colIndex =
      typeof img.col === "number"
        ? img.col
        : getColumnIndexForX(state.x0, state.columnWidth, state.columnGap, img.x!);
    const col = ensureColumn(state, colIndex);
    const height =
      img.h ??
      (Number.isFinite(img.height) && Number.isFinite(img.width)
        ? scaleSize(img, state.columnWidth).h
        : undefined);
    if (!Number.isFinite(height)) {
      throw new Error("Seed images must include width/height or explicit h");
    }
    const placed: PlacedItem = {
      id,
      x: col.x,
      y: img.y!,
      w: img.w ?? state.columnWidth,
      h: height!,
      col: colIndex,
      content: img.content,
    };
    insertOrdered(col.items, placed);
    state.seenIds.add(id);
    updateColumnCursors(col);
  }
}

/** Keep column items sorted by y. */
function insertOrdered(items: PlacedItem[], item: PlacedItem): void {
  if (!items.length || item.y >= items[items.length - 1].y) {
    items.push(item);
    return;
  }
  if (item.y <= items[0].y) {
    items.unshift(item);
    return;
  }
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (items[mid].y < item.y) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  items.splice(low, 0, item);
}

/** Heal gaps between stacked items inside a single column. */
function healColumnGaps(
  state: LayoutState,
  colIndex: number,
  bounds: Bounds,
  dy: number,
  dx: number,
  acquireImage: () => MasonryImage,
  addedSet: Set<string | number>
): void {
  const col = state.columns.get(colIndex);
  if (!col || col.items.length < 2) return;

  while (true) {
    const gap = visibleGap(col, bounds);
    if (!gap.topItem || !gap.bottomItem || gap.gapPx <= EPSILON) {
      return;
    }

    let anchor: "top" | "bottom";
    if (dy > 0) {
      anchor = "bottom";
    } else if (dy < 0) {
      anchor = "top";
    } else if (dx !== 0) {
      anchor = gap.topItem.h <= gap.bottomItem.h ? "top" : "bottom";
    } else {
      anchor = "bottom";
    }

    if (anchor === "bottom") {
      if (!fillGapFromBottom(state, col, colIndex, bounds, acquireImage, addedSet)) {
        return;
      }
    } else {
      if (!fillGapFromTop(state, col, colIndex, bounds, acquireImage, addedSet)) {
        return;
      }
    }
  }
}

/** Fill a gap by anchoring the bottom segment. */
function fillGapFromBottom(
  state: LayoutState,
  col: ColumnState,
  colIndex: number,
  bounds: Bounds,
  acquireImage: () => MasonryImage,
  addedSet: Set<string | number>
): boolean {
  const gap = visibleGap(col, bounds);
  if (!gap.bottomItem || !gap.topItem || gap.gapPx <= EPSILON) {
    return false;
  }
  if (gap.gapPx > gap.bottomItem.h + EPSILON) {
    const placed = insertAboveIndex(state, col, colIndex, gap.bottomIndex, acquireImage());
    addedSet.add(placed.id);
    return true;
  }
  shiftSegment(col, gap.bottomIndex, col.items.length - 1, -gap.gapPx);
  return false;
}

/** Fill a gap by anchoring the top segment. */
function fillGapFromTop(
  state: LayoutState,
  col: ColumnState,
  colIndex: number,
  bounds: Bounds,
  acquireImage: () => MasonryImage,
  addedSet: Set<string | number>
): boolean {
  const gap = visibleGap(col, bounds);
  if (!gap.bottomItem || !gap.topItem || gap.gapPx <= EPSILON) {
    return false;
  }
  if (gap.gapPx > gap.topItem.h + EPSILON) {
    const placed = insertBelowIndex(state, col, colIndex, gap.topIndex, acquireImage());
    addedSet.add(placed.id);
    return true;
  }
  shiftSegment(col, 0, gap.topIndex, gap.gapPx);
  return false;
}

/** Apply offset to a contiguous slice of column items. */
function shiftSegment(col: ColumnState, start: number, end: number, delta: number): void {
  if (delta === 0 || start < 0 || end < start) return;
  for (let i = start; i <= end && i < col.items.length; i += 1) {
    col.items[i].y += delta;
  }
  updateColumnCursors(col);
}

/** Insert a new item directly above the reference index. */
function insertAboveIndex(
  state: LayoutState,
  col: ColumnState,
  colIndex: number,
  neighborIndex: number,
  img: MasonryImage
): PlacedItem {
  const { w, h } = scaleSize(img, state.columnWidth);
  const anchor = col.items[neighborIndex];
  const y = anchor.y - h;
  const placed: PlacedItem = {
    id: img.id!,
    x: col.x,
    y,
    w,
    h,
    col: colIndex,
    content: img.content,
  };
  col.items.splice(neighborIndex, 0, placed);
  updateColumnCursors(col);
  return placed;
}

/** Insert a new item directly below the reference index. */
function insertBelowIndex(
  state: LayoutState,
  col: ColumnState,
  colIndex: number,
  neighborIndex: number,
  img: MasonryImage
): PlacedItem {
  const { w, h } = scaleSize(img, state.columnWidth);
  const anchor = col.items[neighborIndex];
  const y = anchor.y + anchor.h;
  const placed: PlacedItem = {
    id: img.id!,
    x: col.x,
    y,
    w,
    h,
    col: colIndex,
    content: img.content,
  };
  col.items.splice(neighborIndex + 1, 0, placed);
  updateColumnCursors(col);
  return placed;
}

/** Keep cursorTop/cursorBottom aligned with current items. */
function updateColumnCursors(col: ColumnState): void {
  col.cursorTop = columnTopY(col);
  col.cursorBottom = columnBottomY(col);
  if (!Number.isFinite(col.cursorTop)) {
    col.cursorTop = 0;
  }
  if (!Number.isFinite(col.cursorBottom)) {
    col.cursorBottom = 0;
  }
}

/** Expand bounds vertically by preloadY. */
function expandBoundsY(bounds: Bounds, preloadY: number): Bounds {
  return {
    x: bounds.x,
    y: bounds.y - preloadY,
    width: bounds.width,
    height: bounds.height + preloadY * 2,
  };
}

/** Binary search helper for visibleGap (first item whose bottom >= limit). */
function findFirstItemWithBottomAtLeast(items: PlacedItem[], limit: number): number {
  let low = 0;
  let high = items.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (items[mid].y + items[mid].h >= limit) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return result;
}

/** Binary search helper for visibleGap (last item whose top <= limit). */
function findLastItemWithTopAtMost(items: PlacedItem[], limit: number): number {
  let low = 0;
  let high = items.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (items[mid].y <= limit) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

import type { GridItem, Viewport } from "../components/PannableGrid";

// minimal image input for masonry
export type MasonryImage = {
  id?: string | number;
  width?: number;      // natural width
  height?: number;     // natural height
  content: React.ReactNode; // what to render (e.g., <img .../>)
};

export type MasonryOptions = {
  /** Fixed column width in px (content width, not including gap). */
  columnWidth: number;

  /** Optional number of columns (computed from bounds.width if omitted). */
  columnCount?: number;

  /** Gap between columns in px. Default: 16 */
  columnGap?: number;

  /** Gap between rows in px. Default: 16 */
  rowGap?: number;

  /** World-space rect where layout should be computed/rendered. */
  bounds: { x: number; y: number; width: number; height: number };

  /**
   * Starting height per column (in px). Use this to continue a layout
   * when appending more images (e.g., pagination/virtualization).
   * If provided length differs from columnCount, it will be normalized.
   */
  initialColumnHeights?: number[];

  /**
   * How to position columns horizontally inside bounds when leftover space exists.
   * - 'start': left align
   * - 'center' (default): center the whole column block
   * - 'end': right align
   */
  align?: 'start' | 'center' | 'end';
};

export type MasonryResult = {
  items: GridItem[];
  /** Final per-column accumulated heights after laying out `images`. */
  columnHeights: number[];
  /** X offset of each column (world coords). */
  columnX: number[];
  /** Effective columnWidth used (constant, echo). */
  columnWidth: number;
};

/**
 * Compute a constant-width masonry layout for a list of images.
 * Returns GridItem[] positioned in world coordinates so you can feed them to PannableGrid.
 *
 * Strategy: classic "waterfall" — always place next item into the column with the smallest current height.
 */
export function computeMasonryLayout(
  images: MasonryImage[],
  options: MasonryOptions
): MasonryResult {
  const {
    columnWidth,
    columnCount: columnCountOpt,
    columnGap = 16,
    rowGap = 16,
    bounds,
    initialColumnHeights,
    align = 'center',
  } = options;

  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return { items: [], columnHeights: [], columnX: [], columnWidth };
  }

  // Determine column count (at least 1) from bounds if not provided.
  let columnCount =
    columnCountOpt ??
    Math.max(
      1,
      Math.floor((bounds.width + columnGap) / (columnWidth + columnGap))
    );

  // Horizontal geometry
  const totalColsWidth =
    columnCount * columnWidth + (columnCount - 1) * columnGap;

  let leftOffset = bounds.x; // world-space X where columns start
  if (align === 'center') {
    leftOffset += Math.max(0, (bounds.width - totalColsWidth) / 2);
  } else if (align === 'end') {
    leftOffset += Math.max(0, bounds.width - totalColsWidth);
  }
  // 'start' uses bounds.x directly

  // Precompute X for each column
  const columnX = new Array<number>(columnCount);
  for (let c = 0; c < columnCount; c++) {
    columnX[c] = leftOffset + c * (columnWidth + columnGap);
  }

  // Initialize heights (top of each column, world-space Y)
  const colHeights = new Array<number>(columnCount).fill(bounds.y);
  if (initialColumnHeights && initialColumnHeights.length) {
    // Normalize provided seeds into world space (relative to bounds.y if they look like 0-based)
    // Here we assume seeds are absolute world Y; if you track relative heights, just add bounds.y before passing.
    for (let i = 0; i < columnCount; i++) {
      const seed = initialColumnHeights[i] ?? initialColumnHeights[initialColumnHeights.length - 1] ?? bounds.y;
      colHeights[i] = Number.isFinite(seed) ? seed : bounds.y;
    }
  }

  const laidOut: GridItem[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];

    // Resolve aspect ratio
    const ar = (img.width && img.height ? img.width / img.height : undefined);
    if (!ar || !Number.isFinite(ar) || ar <= 0) {
      // Skip items with unknown sizing
      // (Alternatively, you could assign a fallback height.)
      continue;
    }

    // Compute rendered height at the fixed column width
    const renderHeight = Math.max(1, Math.round(columnWidth / ar));

    // Pick the column with the smallest current height
    let targetCol = 0;
    let minH = colHeights[0];
    for (let c = 1; c < columnCount; c++) {
      const h = colHeights[c];
      if (h < minH) {
        minH = h;
        targetCol = c;
      }
    }

    const x = columnX[targetCol];
    const y = colHeights[targetCol];

    // Only add to output if it intersects the vertical slice we care about.
    // This helps when using the function within a world-window (virtualization).
    // Intersection test between [y, y+renderHeight] and [bounds.y - overscan, bounds.y + bounds.height + overscan]
    const itemBottom = y + renderHeight;
    const viewTop = bounds.y;
    const viewBottom = bounds.y + bounds.height;
    const intersectsVertically = !(itemBottom < viewTop || y > viewBottom);

    if (intersectsVertically) {
      laidOut.push({
        id: img.id ?? i,
        x,
        y,
        content: img.content,
      });
    }

    // Advance the column height (always, even if culling from output)
    colHeights[targetCol] = y + renderHeight + rowGap;
  }

  return {
    items: laidOut,
    columnHeights: colHeights,
    columnX,
    columnWidth,
  };
}

export interface PlacedImage {
  id?: string | number;
  x: number;
  y: number;
  width: number;
  height: number;
  content: React.ReactNode;
  columnIndex: number;
}

interface ColumnState {
  columnIndex: number;
  items: PlacedImage[];
}

interface MasonryState {
  columnWidth: number;
  columnGap: number;
  rowGap: number;
  originX: number;
  originY: number;
  generator: () => Promise<MasonryImage>;
  placedImages: PlacedImage[];
  columns: Map<number, ColumnState>;
}

export type ColumnSnapshot = {
  columnIndex: number;
  items: PlacedImage[];
};

type MasonryLayoutConfig = {
  columnWidth: number;
  columnGap: number;
  rowGap: number;
  originX?: number;
  originY?: number;
  generator: () => Promise<MasonryImage>;
};

const BASE_OVERSCAN_MULTIPLIER = 1;

export class MasonryLayout {
  private state: MasonryState;
  private columnBounds: { min: number | null; max: number | null } = {
    min: null,
    max: null,
  };
  private initializationPromise: Promise<void> | null = null;
  private pendingUpdate: Promise<void> = Promise.resolve();
  private readonly horizontalOverscan: number;
  private readonly verticalOverscan: number;

  constructor(config: MasonryLayoutConfig) {
    const { columnWidth, columnGap, rowGap, originX = 0, originY = 0, generator } =
      config;
    this.state = {
      columnWidth,
      columnGap,
      rowGap,
      originX,
      originY,
      generator,
      placedImages: [],
      columns: new Map(),
    };
    const span = columnWidth + columnGap;
    this.horizontalOverscan = Math.max(span, 1) * BASE_OVERSCAN_MULTIPLIER;
    this.verticalOverscan =
      Math.max(columnWidth, rowGap * 2, 1) * BASE_OVERSCAN_MULTIPLIER;
  }

  /**
   * Returns the items that intersect the requested viewport after ensuring
   * initialization and border expansion happen in deterministic order.
   */
  public async getItems(view: Viewport): Promise<GridItem[]> {
    await this.ensureInitialized(view);
    await this.scheduleBorderUpdates(view);
    return this.state.placedImages
    // return this.collectVisibleItems(view);
  }

  private get columnSpan(): number {
    return this.state.columnWidth + this.state.columnGap;
  }

  private async ensureInitialized(view: Viewport): Promise<void> {
    if (this.state.columns.size > 0) {
      return;
    }
    if (!this.initializationPromise) {
      this.initializationPromise = this.initialize(view).finally(() => {
        this.initializationPromise = null;
      });
    }
    return this.initializationPromise;
  }

  private async initialize(view: Viewport): Promise<void> {
    this.ensureColumnsCoverViewport(view);
    const targetBottom = view.y + view.height + this.verticalOverscan;
    const { min, max } = this.getRequiredColumnRange(view);
    for (let columnIndex = min; columnIndex <= max; columnIndex++) {
      const column = this.getOrCreateColumn(columnIndex);
      await this.fillColumnDownward(column, targetBottom);
    }
  }

  private ensureColumnsCoverViewport(view: Viewport): void {
    const { min, max } = this.getRequiredColumnRange(view);
    for (let idx = min; idx <= max; idx++) {
      this.getOrCreateColumn(idx);
    }
  }

  private scheduleBorderUpdates(view: Viewport): Promise<void> {
    // Queue border expansion work to avoid simultaneous mutations.
    const scheduled = this.pendingUpdate.then(() => this.processBorders(view));
    this.pendingUpdate = scheduled.catch(() => {});
    return scheduled;
  }

  private async processBorders(view: Viewport): Promise<void> {
    this.ensureColumnsCoverViewport(view);
    // Border expansion order: top → right → left → bottom keeps healing predictable.
    await this.extendColumnsOnTop(view);
    await this.extendColumnsOnRight(view);
    await this.extendColumnsOnLeft(view);
    await this.extendColumnsOnBottom(view);
  }

  private getRequiredColumnRange(view: Viewport): { min: number; max: number } {
    const startX = view.x - this.horizontalOverscan;
    const endX = view.x + view.width + this.horizontalOverscan;
    return this.getColumnRangeForXSpan(startX, endX);
  }

  private getColumnRangeForXSpan(startX: number, endX: number): {
    min: number;
    max: number;
  } {
    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    const span = this.columnSpan;
    const min = Math.floor((left - this.state.originX) / span);
    const max = Math.floor((right - this.state.originX) / span);
    return { min, max };
  }

  private getColumnIndexesInRange(view: Viewport): number[] {
    const { min, max } = this.getRequiredColumnRange(view);
    const indexes: number[] = [];
    for (let idx = min; idx <= max; idx++) {
      if (this.state.columns.has(idx)) {
        indexes.push(idx);
      }
    }
    return indexes;
  }

  private getColumnX(columnIndex: number): number {
    return this.state.originX + columnIndex * this.columnSpan;
  }

  private getOrCreateColumn(columnIndex: number): ColumnState {
    const existing = this.state.columns.get(columnIndex);
    if (existing) {
      return existing;
    }
    const column: ColumnState = { columnIndex, items: [] };
    this.state.columns.set(columnIndex, column);
    if (this.columnBounds.min === null || columnIndex < this.columnBounds.min) {
      this.columnBounds.min = columnIndex;
    }
    if (this.columnBounds.max === null || columnIndex > this.columnBounds.max) {
      this.columnBounds.max = columnIndex;
    }
    return column;
  }

  private async fillColumnDownward(
    column: ColumnState,
    targetBottom: number,
  ): Promise<void> {
    let cursorY =
      column.items.length > 0
        ? column.items[column.items.length - 1].y +
          column.items[column.items.length - 1].height +
          this.state.rowGap
        : this.state.originY;
    // Keep requesting images until the column reaches the bottom border plus overscan.
    while (cursorY < targetBottom) {
      const image = await this.state.generator();
      const scaledHeight = this.computeScaledHeight(image);
      if (scaledHeight === null) {
        continue;
      }
      const placed = this.createPlacedImage(
        image,
        column.columnIndex,
        cursorY,
        scaledHeight,
      );
      column.items.push(placed);
      this.state.placedImages.push(placed);
      healColumnAfterBottomInsertion(
        column,
        column.items.length - 1,
        this.state,
      );
      cursorY = column.items[column.items.length - 1].y +
        column.items[column.items.length - 1].height +
        this.state.rowGap;
    }
  }

  private async extendColumnsOnTop(view: Viewport): Promise<void> {
    const borderTop = view.y - this.verticalOverscan;
    // Scan left → right across columns filling the uncovered top border.
    const columnIndexes = this.getColumnIndexesInRange(view);
    for (const columnIndex of columnIndexes) {
      const column = this.state.columns.get(columnIndex);
      if (!column || column.items.length === 0) {
        continue;
      }
      await this.extendColumnUpward(column, borderTop);
    }
  }

  private async extendColumnUpward(
    column: ColumnState,
    borderTop: number,
  ): Promise<void> {
    while (true) {
      const topItem = column.items[0];
      if (!topItem || topItem.y <= borderTop) {
        break;
      }
      const image = await this.state.generator();
      const scaledHeight = this.computeScaledHeight(image);
      if (scaledHeight === null) {
        continue;
      }
      const y = topItem.y - this.state.rowGap - scaledHeight;
      const placed = this.createPlacedImage(
        image,
        column.columnIndex,
        y,
        scaledHeight,
      );
      column.items.unshift(placed);
      this.state.placedImages.push(placed);
      healColumnAfterTopInsertion(column, 0, this.state);
    }
  }

  private async extendColumnsOnBottom(view: Viewport): Promise<void> {
    const borderBottom = view.y + view.height + this.verticalOverscan;
    // Extend each column downward along the bottom border with newly generated images.
    const columnIndexes = this.getColumnIndexesInRange(view);
    for (const columnIndex of columnIndexes) {
      const column = this.state.columns.get(columnIndex);
      if (!column || column.items.length === 0) {
        continue;
      }
      await this.extendColumnDownward(column, borderBottom);
    }
  }

  private async extendColumnDownward(
    column: ColumnState,
    borderBottom: number,
  ): Promise<void> {
    while (true) {
      const last = column.items[column.items.length - 1];
      const y =
        last !== undefined
          ? last.y + last.height + this.state.rowGap
          : this.state.originY;
      if (y >= borderBottom) {
        break;
      }
      const image = await this.state.generator();
      const scaledHeight = this.computeScaledHeight(image);
      if (scaledHeight === null) {
        continue;
      }
      const placed = this.createPlacedImage(
        image,
        column.columnIndex,
        y,
        scaledHeight,
      );
      column.items.push(placed);
      this.state.placedImages.push(placed);
      healColumnAfterBottomInsertion(
        column,
        column.items.length - 1,
        this.state,
      );
    }
  }

  private async extendColumnsOnRight(view: Viewport): Promise<void> {
    // When the viewport exposes new horizontal space to the right, build entire columns top→bottom.
    const { max: requiredMax } = this.getRequiredColumnRange(view);
    if (requiredMax === undefined || this.columnBounds.max === null) {
      return;
    }
    for (
      let columnIndex = (this.columnBounds.max ?? 0);
      columnIndex <= requiredMax;
      columnIndex++
    ) {
      const column = this.getOrCreateColumn(columnIndex);
      if (column.items.length === 0) {
        await this.populateNewColumn(column, view);
      }
    }
  }

  private async extendColumnsOnLeft(view: Viewport): Promise<void> {
    // Mirror the right border logic when adding new columns on the left side.
    const { min: requiredMin } = this.getRequiredColumnRange(view);
    if (requiredMin === undefined || this.columnBounds.min === null) {
      return;
    }
    for (
      let columnIndex = (this.columnBounds.min ?? 0);
      columnIndex >= requiredMin;
      columnIndex--
    ) {
      const column = this.getOrCreateColumn(columnIndex);
      if (column.items.length === 0) {
        await this.populateNewColumn(column, view);
      }
    }
  }

  private async populateNewColumn(
    column: ColumnState,
    view: Viewport,
  ): Promise<void> {
    if (column.items.length > 0) {
      return;
    }
    const borderTop = view.y - this.verticalOverscan;
    const borderBottom = view.y + view.height + this.verticalOverscan;
    let cursorY = borderTop;
    // Walk the new column top → bottom and fill it so the visible border is covered.
    while (cursorY < borderBottom) {
      const image = await this.state.generator();
      const scaledHeight = this.computeScaledHeight(image);
      if (scaledHeight === null) {
        continue;
      }
      const placed = this.createPlacedImage(
        image,
        column.columnIndex,
        cursorY,
        scaledHeight,
      );
      column.items.push(placed);
      this.state.placedImages.push(placed);
      healColumnAfterBottomInsertion(
        column,
        column.items.length - 1,
        this.state,
      );
      cursorY = column.items[column.items.length - 1].y +
        column.items[column.items.length - 1].height +
        this.state.rowGap;
    }
  }

  private collectVisibleItems(view: Viewport): GridItem[] {
    // Apply overscan margins so rendering doesn't pop when the camera moves slightly.
    const windowLeft = view.x - this.horizontalOverscan;
    const windowRight = view.x + view.width + this.horizontalOverscan;
    const windowTop = view.y - this.verticalOverscan;
    const windowBottom = view.y + view.height + this.verticalOverscan;
    return this.state.placedImages
      .filter((placed) => {
        const itemRight = placed.x + placed.width;
        const itemBottom = placed.y + placed.height;
        const horizontalIntersect = itemRight >= windowLeft && placed.x <= windowRight;
        const verticalIntersect = itemBottom >= windowTop && placed.y <= windowBottom;
        return horizontalIntersect && verticalIntersect;
      })
      .map((placed) => ({
        id: placed.id,
        x: placed.x,
        y: placed.y,
        content: placed.content,
      }));
  }

  private computeScaledHeight(image: MasonryImage): number | null {
    const naturalWidth = image.width;
    const naturalHeight = image.height;
    if (
      !Number.isFinite(naturalWidth) ||
      naturalWidth <= 0 ||
      !Number.isFinite(naturalHeight) ||
      naturalHeight <= 0
    ) {
      return null;
    }
    return Math.max(
      1,
      Math.round((naturalHeight * this.state.columnWidth) / naturalWidth),
    );
  }

  private createPlacedImage(
    image: MasonryImage,
    columnIndex: number,
    y: number,
    height: number,
  ): PlacedImage {
    return {
      id: image.id,
      x: this.getColumnX(columnIndex),
      y,
      width: this.state.columnWidth,
      height,
      content: image.content,
      columnIndex,
    };
  }

  /**
   * Helpers primarily aimed at testing/inspection.
   */
  public getDebugPlacedImages(): PlacedImage[] {
    return this.state.placedImages.map((img) => ({ ...img }));
  }

  public getDebugColumns(): ColumnSnapshot[] {
    return Array.from(this.state.columns.values()).map((column) => ({
      columnIndex: column.columnIndex,
      items: column.items.map((item) => ({ ...item })),
    }));
  }
}

// Check if two placed images shrink their vertical gap below the allowed tolerance.
function rectanglesOverlapVertically(
  a: PlacedImage,
  b: PlacedImage,
  verticalGapTolerance: number = 0,
): boolean {
  return (
    a.y + a.height + verticalGapTolerance > b.y &&
    b.y + b.height + verticalGapTolerance > a.y
  );
}

function healColumnAfterTopInsertion(
  column: ColumnState,
  insertedIndex: number,
  state: MasonryState,
): void {
  // Shift the newly inserted top item (and anyone above) upward if it overlaps the next row.
  const inserted = column.items[insertedIndex];
  const below = column.items[insertedIndex + 1];
  if (!below) {
    return;
  }
  if (
    !rectanglesOverlapVertically(inserted, below, -state.rowGap)
  ) {
    return;
  }
  const desiredY = below.y - state.rowGap - inserted.height;
  const delta = desiredY - inserted.y;
  if (!Number.isFinite(delta) || delta === 0) {
    return;
  }
  for (let i = 0; i <= insertedIndex; i++) {
    column.items[i].y += delta;
  }
}

function healColumnAfterBottomInsertion(
  column: ColumnState,
  insertedIndex: number,
  state: MasonryState,
): void {
  // Push the bottom insertion (and all rows below) downward if overlap occurs.
  const inserted = column.items[insertedIndex];
  const above = column.items[insertedIndex - 1];
  if (!above) {
    return;
  }
  if (
    !rectanglesOverlapVertically(above, inserted, -state.rowGap)
  ) {
    return;
  }
  const desiredY = above.y + above.height + state.rowGap;
  const delta = desiredY - inserted.y;
  if (!Number.isFinite(delta) || delta === 0) {
    return;
  }
  for (let i = insertedIndex; i < column.items.length; i++) {
    column.items[i].y += delta;
  }
}

// Example usage:
// const generator = createAICImageGenerator();
// const layout = new MasonryLayout({
//   columnWidth: 200,
//   columnGap: 16,
//   rowGap: 16,
//   originX: 0,
//   originY: 0,
//   generator,
// });
// const dataFn = (view: Viewport) => layout.getItems(view);

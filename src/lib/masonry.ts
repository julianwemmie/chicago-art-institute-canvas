import type { GridItem, Viewport } from "../components/PannableGrid";

export type MasonryImage = {
  id?: string | number;
  width: number;      // natural width
  height: number;     // natural height
  content: React.ReactNode; // what to render (e.g., <img .../>)
};

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

import type { ReactNode } from "react";
import type { GridItem, Viewport } from "../components/PannableGrid";
import { GeneratorFunc } from "../api/aic";

export type MasonryImage = {
  id?: string | number;
  width: number;
  height: number;
  content: ReactNode;
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
  generator: GeneratorFunc;
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
  generator: GeneratorFunc;
};

const BASE_OVERSCAN_MULTIPLIER = 1;
const POSITION_EPSILON = 0.1;

const nearlyEqual = (a: number, b: number, epsilon: number = POSITION_EPSILON): boolean =>
  Math.abs(a - b) <= epsilon;

export class MasonryLayout {
  private state: MasonryState;
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

  public async getItems(view: Viewport): Promise<GridItem[]> {
    await this.ensureInitialized(view);
    await this.scheduleBorderUpdates(view);
    return this.state.placedImages.map((placed) => this.toGridItem(placed))
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
    const { min, max } = this.getRequiredColumnRange(view);
    for (let columnIndex = min; columnIndex <= max; columnIndex++) {
      const column = this.getOrCreateColumn(columnIndex);
      await this.populateNewColumn(column, view);
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
    return column;
  }

  private async extendColumnsOnTop(view: Viewport): Promise<void> {
    const columnIndexes = this.getColumnIndexesInRange(view);
    for (const columnIndex of columnIndexes) {
      const column = this.state.columns.get(columnIndex);
      if (!column || column.items.length === 0) {
        continue;
      }
      const imagesInViewport = this.getColumnItemsInViewport(column.columnIndex, view);
      const borderTop = view.y - this.verticalOverscan;
      if (imagesInViewport[0] && nearlyEqual(imagesInViewport[0].y, borderTop)) {
        continue
      }
      await this.extendColumnUpward(column, imagesInViewport);
    }
  }

  private async extendColumnUpward(
    column: ColumnState,
    imagesInViewport: PlacedImage[],
  ): Promise<void> {
    const topViewPortItem = imagesInViewport[0];

    if (!topViewPortItem) {
      return
    }

    const topIndex = column.items.indexOf(topViewPortItem);
    const aboveItem = topIndex > 0 ? column.items[topIndex - 1] : undefined;


    if (
      aboveItem &&
      nearlyEqual(
        aboveItem.y + aboveItem.height + this.state.rowGap,
        topViewPortItem.y,
      )
    ) {
      return
    }

    let image: MasonryImage;
    let scaledHeight: number | null;
    let fetchAttempts = 0;

    while (true) {
      fetchAttempts++;
      if (fetchAttempts > 10) {
        console.warn('extendColumnUpward: exceeded max fetch attempts');
        return;
      }
      image = await this.state.generator();
      scaledHeight = this.computeScaledHeight(image);
      if (scaledHeight === null) {
        continue;
      }
      break;
    }

    if (aboveItem && 
      (topViewPortItem.y - this.state.rowGap - scaledHeight < aboveItem.y + aboveItem.height + this.state.rowGap)
    ) {
      // shift all items above up
      const delta = (aboveItem.y + aboveItem.height + this.state.rowGap) - (topViewPortItem.y - this.state.rowGap - scaledHeight);
      for (let i = 0; i < topIndex; i++) {
        column.items[i].y -= delta;
      }
    }

    const y = topViewPortItem.y - this.state.rowGap - scaledHeight;
    const placed = this.createPlacedImage(
      image,
      column.columnIndex,
      y,
      scaledHeight,
    );
    column.items.push(placed);
    column.items.sort((a, b) => a.y - b.y);
    this.state.placedImages.push(placed);
    this.state.placedImages.sort((a, b) => a.y - b.y);
  }

  private async extendColumnsOnBottom(view: Viewport): Promise<void> {
    // Extend each column downward along the bottom border with newly generated images.
    const columnIndexes = this.getColumnIndexesInRange(view);
    for (const columnIndex of columnIndexes) {
      const column = this.state.columns.get(columnIndex);
      if (!column || column.items.length === 0) {
        continue;
      }
      const imagesInViewport = this.getColumnItemsInViewport(column.columnIndex, view);
      const borderBottom = view.y + view.height + this.verticalOverscan;
      const lastImageInViewport = imagesInViewport[imagesInViewport.length - 1];
      if (lastImageInViewport?.y + lastImageInViewport?.height + this.state.rowGap >= borderBottom) {
        continue
      }
      await this.extendColumnDownward(column, imagesInViewport);
    }
  }

  private async extendColumnDownward(
    column: ColumnState,
    itemsInViewport: PlacedImage[]
  ): Promise<void> {
    const bottomViewPortItem = itemsInViewport[itemsInViewport.length - 1];

    if (!bottomViewPortItem) {
      return
    }

    const bottomIndex = column.items.indexOf(bottomViewPortItem);
    const belowItem = bottomIndex >= 0 ? column.items[bottomIndex + 1] : undefined;

    if (
      belowItem &&
      nearlyEqual(
        bottomViewPortItem.y + bottomViewPortItem.height + this.state.rowGap,
        belowItem.y,
      )
    ) {
      return
    }

    let image: MasonryImage;
    let scaledHeight: number | null;
    let fetchAttempts = 0;

    while (true) {
      fetchAttempts++;
      if (fetchAttempts > 10) {
        console.warn('extendColumnDownward: exceeded max fetch attempts');
        return;
      }
      image = await this.state.generator();
      scaledHeight = this.computeScaledHeight(image);
      if (scaledHeight === null) {
        continue;
      }
      break;
    }

    if (belowItem &&
      (bottomViewPortItem.y + bottomViewPortItem.height + this.state.rowGap + scaledHeight > belowItem.y - this.state.rowGap)
    ) {
      // shift all items below down
      const delta = (bottomViewPortItem.y + bottomViewPortItem.height + this.state.rowGap + scaledHeight) - (belowItem.y - this.state.rowGap);
      for (let i = bottomIndex + 1; i < column.items.length; i++) {
        column.items[i].y += delta;
      }
    }

    const y = bottomViewPortItem.y + bottomViewPortItem.height + this.state.rowGap;
    const placed = this.createPlacedImage(
      image,
      column.columnIndex,
      y,
      scaledHeight,
    );
    column.items.push(placed);
    column.items.sort((a, b) => a.y - b.y);
    this.state.placedImages.push(placed);
    this.state.placedImages.sort((a, b) => a.y - b.y);
  }

  private async extendColumnsOnRight(view: Viewport): Promise<void> {
    // When the viewport exposes new horizontal space to the right, build entire columns top→bottom.
    const { max: requiredMax } = this.getRequiredColumnRange(view);
    if (requiredMax === undefined) {
      return;
    }
    const column = this.getOrCreateColumn(requiredMax);

    // get images in within viewport
    const imagesInViewport = this.getColumnItemsInViewport(column.columnIndex, view);
    if (imagesInViewport.length === 0) {
      await this.populateNewColumn(column, view);
      return
    }

    const borderTop = view.y - this.verticalOverscan;
    if (imagesInViewport[0] && nearlyEqual(imagesInViewport[0].y, borderTop)) {
      return
    }
    await this.extendColumnUpward(column, imagesInViewport);

    const borderBottom = view.y + view.height + this.verticalOverscan;
    const lastImageInViewport = imagesInViewport[imagesInViewport.length - 1];
    if (lastImageInViewport?.y + lastImageInViewport?.height + this.state.rowGap >= borderBottom) {
      return
    }
    await this.extendColumnDownward(column, imagesInViewport);
  }

  

  private async extendColumnsOnLeft(view: Viewport): Promise<void> {
    // Mirror the right border logic when adding new columns on the left side.
    const { min: requiredMin } = this.getRequiredColumnRange(view);
    if (requiredMin === undefined) {
      return;
    }
    const column = this.getOrCreateColumn(requiredMin);

    // get images in within viewport
    const imagesInViewport = this.getColumnItemsInViewport(column.columnIndex, view);
    
    if (imagesInViewport.length === 0) {
      await this.populateNewColumn(column, view);
      return
    }

    const borderTop = view.y - this.verticalOverscan;
    if (imagesInViewport[0] && nearlyEqual(imagesInViewport[0].y, borderTop)) {
      return
    }
    await this.extendColumnUpward(column, imagesInViewport);

    const borderBottom = view.y + view.height + this.verticalOverscan;
    const lastImageInViewport = imagesInViewport[imagesInViewport.length - 1];
    if (lastImageInViewport?.y + lastImageInViewport?.height + this.state.rowGap >= borderBottom) {
      return
    }
    await this.extendColumnDownward(column, imagesInViewport);
  }

  private getColumnItemsInViewport(columnIndex: number, view: Viewport): PlacedImage[] {
    const column = this.state.columns.get(columnIndex);
    if (!column) {
      return [];
    }
    const borderTop = view.y - this.verticalOverscan;
    const borderBottom = view.y + view.height + this.verticalOverscan;
    let itemsInView = [];
    for (const item of column.items) {
      if (item.y >= borderTop && item.y <= borderBottom) {
        itemsInView.push(item);
      }
    }
    return itemsInView;
  }

  private async populateNewColumn(
    column: ColumnState,
    view: Viewport,
  ): Promise<void> {
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
      cursorY = placed.y + placed.height + this.state.rowGap;
    }
  }

  private async healColumnGaps(column: ColumnState, view: Viewport): Promise<void> {
    // KEEP
    const imagesInViewport = this.getColumnItemsInViewport(column.columnIndex, view);

    // start at top image and keep moving down until we find gap
    let currentImageIndex = 0;
    while (currentImageIndex <= imagesInViewport.length) {
      if (imagesInViewport.length === 0) {
        break;
      }
      if (currentImageIndex >= imagesInViewport.length) {
        break;
      }
      let currentImage = imagesInViewport[currentImageIndex];
      const nextImage = imagesInViewport[currentImageIndex + 1];
      const expectedNextImagePlacement = currentImage.y + currentImage.height + this.state.rowGap;
      if (expectedNextImagePlacement == nextImage.y) {
        currentImageIndex++;
        continue;
      }

      // place image in column
      const image = await this.state.generator();
      const scaledHeight = this.computeScaledHeight(image);
      if (scaledHeight === null) {
        continue;
      }
      const placed = this.createPlacedImage(
        image,
        column.columnIndex,
        expectedNextImagePlacement,
        scaledHeight,
      );
      column.items.splice(column.items.indexOf(currentImage), 0, placed);
      this.state.placedImages.splice(this.state.placedImages.indexOf(currentImage), 0, placed);
      currentImageIndex++;
    }
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

  private toGridItem(placed: PlacedImage): GridItem {
    return {
      id: placed.id,
      x: placed.x,
      y: placed.y,
      content: placed.content,
    };
  }
}

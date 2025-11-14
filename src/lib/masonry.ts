import type { ReactNode } from "react";
import type { GridDataResult, GridItem, Viewport } from "../components/PannableGrid";

export type MasonryImage = {
  id?: string | number;
  width?: number;
  height?: number;
  content: ReactNode;
};

export interface PlacedImage {
  id?: string | number;
  x: number;
  y: number;
  width: number;
  height: number;
  content: ReactNode;
  columnId: number;
}

interface ColumnState {
  id: number;
  index: number;
  x: number;
  items: PlacedImage[];
}

interface MasonryState {
  columnWidth: number;
  columnGap: number;
  rowGap: number;
  originX: number;
  originY: number;
  generator: () => Promise<MasonryImage>;
  columns: ColumnState[];
  columnMap: Map<number, ColumnState>;
  placedImages: PlacedImage[];
  nextColumnId: number;
}

export type ColumnSnapshot = {
  id: number;
  index: number;
  x: number;
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

type Gap = { start: number; end: number };
type InsertionMode = "top" | "bottom" | "middle";

const GAP_EPSILON = 0.5;
const MAX_GAP_ITERATIONS = 400;
const MAX_ITEMS_PER_GAP = 1000;

export class MasonryLayout {
  private state: MasonryState;
  private initializationPromise: Promise<void> | null = null;
  private workQueue: Promise<void> = Promise.resolve();
  private readonly columnSpan: number;
  private readonly horizontalOverscan: number;
  private readonly verticalOverscan: number;

  constructor(config: MasonryLayoutConfig) {
    const {
      columnWidth,
      columnGap,
      rowGap,
      originX = 0,
      originY = 0,
      generator,
    } = config;

    this.state = {
      columnWidth,
      columnGap,
      rowGap,
      originX,
      originY,
      generator,
      columns: [],
      columnMap: new Map(),
      placedImages: [],
      nextColumnId: 0,
    };

    this.columnSpan = columnWidth + columnGap;
    this.horizontalOverscan = Math.max(this.columnSpan, columnWidth);
    this.verticalOverscan = Math.max(columnWidth * 2, rowGap * 4, 1);
  }

  public async getItems(view: Viewport): Promise<GridDataResult> {
    await this.ensureInitialized(view);
    await this.enqueue(() => this.processBorders(view));
    return {
      items: this.collectVisibleItems(view),
      debugItems: this.state.placedImages.map((placed) => this.toGridItem(placed)),
    };
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.workQueue.then(task);
    this.workQueue = next.catch(() => {});
    return next;
  }

  private async ensureInitialized(view: Viewport): Promise<void> {
    if (this.state.columns.length > 0) {
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
    const initialColumn = this.ensureColumn(0);
    const visibleBottom = view.y + view.height + this.verticalOverscan;
    await this.buildColumnFromOrigin(initialColumn, visibleBottom);

    const { min, max } = this.getColumnRange(
      view.x - this.horizontalOverscan,
      view.x + view.width + this.horizontalOverscan,
    );
    for (let idx = min; idx <= max; idx++) {
      const column = this.ensureColumn(idx);
      if (column === initialColumn) {
        continue;
      }
      await this.buildColumnFromOrigin(column, visibleBottom);
    }
  }

  private async buildColumnFromOrigin(
    column: ColumnState,
    targetBottom: number,
  ): Promise<void> {
    let cursor = column.items.length
      ? column.items[column.items.length - 1].y +
        column.items[column.items.length - 1].height +
        this.state.rowGap
      : this.state.originY;

    while (cursor < targetBottom) {
      const image = await this.state.generator();
      const height = this.computeScaledHeight(image);
      if (height == null) {
        continue;
      }
      const placed = this.createPlacedImage(image, column, cursor, height);
      const index = this.insertPlacedImage(column, placed);
      this.healColumnAfterInsertion(column, index, "bottom");
      cursor = placed.y + placed.height + this.state.rowGap;
    }
  }

  private ensureColumnsCoverViewport(view: Viewport): void {
    const viewLeft = view.x - this.horizontalOverscan;
    const viewRight = view.x + view.width + this.horizontalOverscan;
    const { min, max } = this.getColumnRange(viewLeft, viewRight);
    this.ensureColumnsForRange(min, max);
  }

  private async processBorders(view: Viewport): Promise<void> {
    this.ensureColumnsCoverViewport(view);
    await this.processTopBorder(view);
    await this.processRightBorder(view);
    await this.processLeftBorder(view);
    await this.processBottomBorder(view);
  }

  private async processTopBorder(view: Viewport): Promise<void> {
    const columns = this.getColumnsIntersectingView(view);
    const top = view.y - this.verticalOverscan;
    const bottom = view.y;
    for (const column of columns) {
      await this.ensureColumnCoverage(column, top, bottom, "top");
    }
  }

  private async processBottomBorder(view: Viewport): Promise<void> {
    const columns = this.getColumnsIntersectingView(view);
    const top = view.y + view.height;
    const bottom = view.y + view.height + this.verticalOverscan;
    for (const column of columns) {
      await this.ensureColumnCoverage(column, top, bottom, "bottom");
    }
  }

  private async processRightBorder(view: Viewport): Promise<void> {
    const borderLeft = view.x + view.width;
    const borderRight = borderLeft + this.horizontalOverscan;
    const { min, max } = this.getColumnRange(borderLeft, borderRight);
    this.ensureColumnsForRange(min, max);
    const coverageTop = view.y - this.verticalOverscan;
    const coverageBottom = view.y + view.height + this.verticalOverscan;
    for (let idx = min; idx <= max; idx++) {
      const column = this.ensureColumn(idx);
      await this.ensureColumnCoverage(column, coverageTop, coverageBottom, "middle");
    }
  }

  private async processLeftBorder(view: Viewport): Promise<void> {
    const borderRight = view.x;
    const borderLeft = borderRight - this.horizontalOverscan;
    const { min, max } = this.getColumnRange(borderLeft, borderRight);
    this.ensureColumnsForRange(min, max);
    const coverageTop = view.y - this.verticalOverscan;
    const coverageBottom = view.y + view.height + this.verticalOverscan;
    for (let idx = max; idx >= min; idx--) {
      const column = this.ensureColumn(idx);
      await this.ensureColumnCoverage(column, coverageTop, coverageBottom, "middle");
    }
  }

  private getColumnsIntersectingView(view: Viewport): ColumnState[] {
    const windowLeft = view.x - this.horizontalOverscan;
    const windowRight = view.x + view.width + this.horizontalOverscan;
    return this.state.columns.filter((column) => {
      const colLeft = column.x;
      const colRight = column.x + this.state.columnWidth;
      return colRight >= windowLeft && colLeft <= windowRight;
    });
  }

  private async ensureColumnCoverage(
    column: ColumnState,
    startY: number,
    endY: number,
    mode: InsertionMode,
  ): Promise<void> {
    if (startY >= endY - GAP_EPSILON) {
      return;
    }
    let iterations = 0;
    while (iterations++ < MAX_GAP_ITERATIONS) {
      const gap = this.findNextGap(column, startY, endY);
      if (!gap) {
        break;
      }
      const gapMode = this.resolveGapMode(gap, startY, endY, mode);
      await this.fillGap(column, gap, gapMode);
    }
  }

  private resolveGapMode(
    gap: Gap,
    intervalStart: number,
    intervalEnd: number,
    fallback: InsertionMode,
  ): InsertionMode {
    const nearTop = gap.start <= intervalStart + this.state.rowGap + GAP_EPSILON;
    const nearBottom = gap.end >= intervalEnd - this.state.rowGap - GAP_EPSILON;
    if (nearTop && !nearBottom) {
      return "top";
    }
    if (nearBottom && !nearTop) {
      return "bottom";
    }
    if (nearTop && nearBottom) {
      return fallback;
    }
    return "middle";
  }

  private findNextGap(
    column: ColumnState,
    startY: number,
    endY: number,
  ): Gap | null {
    if (startY >= endY - GAP_EPSILON) {
      return null;
    }
    const items = column.items;
    let cursor = startY;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const topLimit = item.y - this.state.rowGap;
      const bottomLimit = item.y + item.height + this.state.rowGap;

      if (bottomLimit <= startY) {
        continue;
      }
      if (topLimit >= endY) {
        break;
      }

      if (cursor < topLimit - GAP_EPSILON) {
        const gapStart = Math.max(cursor, startY);
        const gapEnd = Math.min(topLimit, endY);
        if (gapEnd - gapStart > GAP_EPSILON) {
          return { start: gapStart, end: gapEnd };
        }
      }

      if (cursor < bottomLimit) {
        cursor = bottomLimit;
      }
      if (cursor >= endY - GAP_EPSILON) {
        return null;
      }
    }

    if (cursor < endY - GAP_EPSILON) {
      return { start: cursor, end: endY };
    }
    return null;
  }

  private async fillGap(
    column: ColumnState,
    gap: Gap,
    mode: InsertionMode,
  ): Promise<void> {
    let cursor = gap.start;
    let insertions = 0;

    while (
      cursor < gap.end - GAP_EPSILON &&
      insertions < MAX_ITEMS_PER_GAP
    ) {
      const previous = this.getNeighborBefore(column, cursor);
      if (previous) {
        cursor = Math.max(
          cursor,
          previous.item.y + previous.item.height + this.state.rowGap,
        );
      }

      if (cursor >= gap.end - GAP_EPSILON) {
        break;
      }

      const image = await this.state.generator();
      const height = this.computeScaledHeight(image);
      if (height == null) {
        continue;
      }
      const placed = this.createPlacedImage(image, column, cursor, height);
      const index = this.insertPlacedImage(column, placed);
      this.healColumnAfterInsertion(column, index, mode);

      const actualBottom =
        column.items[index].y + column.items[index].height + this.state.rowGap;
      if (actualBottom <= cursor + GAP_EPSILON) {
        cursor += this.state.rowGap;
      } else {
        cursor = actualBottom;
      }
      insertions += 1;
    }
  }

  private getNeighborBefore(
    column: ColumnState,
    y: number,
  ): { item: PlacedImage; index: number } | null {
    const items = column.items;
    if (items.length === 0) {
      return null;
    }
    let low = 0;
    let high = items.length - 1;
    let match: number | null = null;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (items[mid].y < y) {
        match = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (match == null) {
      return null;
    }
    return { item: items[match], index: match };
  }

  private shiftRange(
    column: ColumnState,
    startIndex: number,
    endIndex: number,
    delta: number,
  ): void {
    if (!Number.isFinite(delta) || Math.abs(delta) < GAP_EPSILON) {
      return;
    }
    for (let i = startIndex; i <= endIndex; i++) {
      column.items[i].y += delta;
    }
  }

  private healColumnAfterInsertion(
    column: ColumnState,
    index: number,
    mode: InsertionMode,
  ): void {
    const checkPrev = mode !== "top";
    const checkNext = mode !== "bottom";
    let iterations = 0;

    while (iterations++ < column.items.length) {
      let moved = false;
      const item = column.items[index];
      if (!item) {
        break;
      }

      const prev = column.items[index - 1];
      if (checkPrev && prev) {
        const desiredY = prev.y + prev.height + this.state.rowGap;
        const delta = desiredY - item.y;
        if (delta > GAP_EPSILON) {
          this.shiftRange(column, index, column.items.length - 1, delta);
          moved = true;
          continue;
        }
      }

      const next = column.items[index + 1];
      if (checkNext && next) {
        const maxY = next.y - this.state.rowGap - item.height;
        const delta = item.y - maxY;
        if (delta > GAP_EPSILON) {
          this.shiftRange(column, 0, index, -delta);
          moved = true;
          continue;
        }
      }

      if (!moved) {
        break;
      }
    }
  }

  private insertPlacedImage(column: ColumnState, placed: PlacedImage): number {
    const index = this.findInsertIndex(column, placed.y);
    column.items.splice(index, 0, placed);
    this.state.placedImages.push(placed);
    return index;
  }

  private findInsertIndex(column: ColumnState, y: number): number {
    let low = 0;
    let high = column.items.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (column.items[mid].y < y) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  private ensureColumnsForRange(min: number, max: number): void {
    for (let idx = min; idx <= max; idx++) {
      this.ensureColumn(idx);
    }
  }

  private ensureColumn(index: number): ColumnState {
    const existing = this.state.columnMap.get(index);
    if (existing) {
      return existing;
    }
    const column: ColumnState = {
      id: this.state.nextColumnId++,
      index,
      x: this.getColumnX(index),
      items: [],
    };
    const insertAt = this.state.columns.findIndex((col) => col.index > index);
    if (insertAt === -1) {
      this.state.columns.push(column);
    } else {
      this.state.columns.splice(insertAt, 0, column);
    }
    this.state.columnMap.set(index, column);
    return column;
  }

  private getColumnX(index: number): number {
    return this.state.originX + index * this.columnSpan;
  }

  private getColumnRange(startX: number, endX: number): { min: number; max: number } {
    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    const span = this.columnSpan || 1;
    const min = Math.floor((left - this.state.originX) / span);
    const max = Math.floor((right - this.state.originX) / span);
    return { min, max };
  }

  private computeScaledHeight(image: MasonryImage): number | null {
    if (
      !Number.isFinite(image.width ?? NaN) ||
      !Number.isFinite(image.height ?? NaN) ||
      !image.width ||
      !image.height
    ) {
      return null;
    }
    return Math.max(
      1,
      Math.round((image.height * this.state.columnWidth) / image.width),
    );
  }

  private createPlacedImage(
    image: MasonryImage,
    column: ColumnState,
    y: number,
    height: number,
  ): PlacedImage {
    return {
      id: image.id,
      x: column.x,
      y,
      width: this.state.columnWidth,
      height,
      content: image.content,
      columnId: column.id,
    };
  }

  private toGridItem(placed: PlacedImage): GridItem {
    return {
      id: placed.id,
      x: placed.x,
      y: placed.y,
      content: placed.content,
    };
  }

  private collectVisibleItems(view: Viewport): GridItem[] {
    const windowLeft = view.x - this.horizontalOverscan;
    const windowRight = view.x + view.width + this.horizontalOverscan;
    const windowTop = view.y - this.verticalOverscan;
    const windowBottom = view.y + view.height + this.verticalOverscan;

    return this.state.placedImages
      .filter((placed) => {
        const right = placed.x + placed.width;
        const bottom = placed.y + placed.height;
        const horizontal = right >= windowLeft && placed.x <= windowRight;
        const vertical = bottom >= windowTop && placed.y <= windowBottom;
        return horizontal && vertical;
      })
      .map((placed) => this.toGridItem(placed));
  }

  public getDebugPlacedImages(): PlacedImage[] {
    return this.state.placedImages.map((img) => ({ ...img }));
  }

  public getDebugColumns(): ColumnSnapshot[] {
    return this.state.columns.map((column) => ({
      id: column.id,
      index: column.index,
      x: column.x,
      items: column.items.map((item) => ({ ...item })),
    }));
  }
}

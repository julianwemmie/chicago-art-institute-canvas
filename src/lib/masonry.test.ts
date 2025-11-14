import { describe, expect, it } from "vitest";
import { MasonryLayout, ColumnSnapshot, MasonryImage } from "./masonry";

const DEFAULT_IMAGES: MasonryImage[] = [
  { width: 150, height: 200, content: null },
  { width: 200, height: 120, content: null },
  { width: 100, height: 180, content: null },
  { width: 260, height: 200, content: null },
];

function createMockGenerator(images: MasonryImage[]): () => Promise<MasonryImage> {
  const pool = images.map((image) => ({
    ...image,
    id: image.id ?? `${image.width}x${image.height}`,
  }));
  let index = 0;
  return async () => {
    const next = pool[index % pool.length];
    index += 1;
    return {
      ...next,
      id: next.id,
    };
  };
}

describe("MasonryLayout", () => {
  const view = { x: 0, y: 0, width: 220, height: 220 };

  it("initializes columns covering the viewport", async () => {
    const generator = createMockGenerator(DEFAULT_IMAGES);
    const layout = new MasonryLayout({
      columnWidth: 100,
      columnGap: 10,
      rowGap: 10,
      generator,
    });

    const items = await layout.getItems(view);
    expect(items.length).toBeGreaterThan(0);

    const columns = layout.getDebugColumns();
    expect(columns.length).toBeGreaterThanOrEqual(2);
    columns.forEach((column) => {
      expect(column.items.length).toBeGreaterThan(0);
    });
  });

  it("extends upward border when viewport moves above origin", async () => {
    const generator = createMockGenerator(DEFAULT_IMAGES);
    const layout = new MasonryLayout({
      columnWidth: 90,
      columnGap: 10,
      rowGap: 12,
      generator,
    });

    await layout.getItems(view);
    await layout.getItems({
      x: 0,
      y: -250,
      width: 220,
      height: 200,
    });

    const placed = layout.getDebugPlacedImages();
    expect(placed.some((item) => item.y < 0)).toBe(true);
  });

  it("always maintains the configured rowGap between items in a column", async () => {
    const rowGap = 16;
    const generator = createMockGenerator(DEFAULT_IMAGES);
    const layout = new MasonryLayout({
      columnWidth: 110,
      columnGap: 8,
      rowGap,
      generator,
    });

    await layout.getItems(view);

    const columns = layout.getDebugColumns();
    columns.forEach((column: ColumnSnapshot) => {
      for (let i = 1; i < column.items.length; i += 1) {
        const prev = column.items[i - 1];
        const current = column.items[i];
        const gap = current.y - (prev.y + prev.height);
        expect(gap).toBeGreaterThanOrEqual(rowGap - 0.01);
      }
    });
  });

  it("creates additional columns when panning to the right", async () => {
    const generator = createMockGenerator(DEFAULT_IMAGES);
    const layout = new MasonryLayout({
      columnWidth: 100,
      columnGap: 10,
      rowGap: 12,
      generator,
    });

    await layout.getItems(view);
    await layout.getItems({ x: 500, y: 0, width: 220, height: 220 });

    const columns = layout.getDebugColumns();
    expect(columns.some((column) => column.columnIndex >= 4)).toBe(true);
  });
});

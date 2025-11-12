import { GridItem } from "../components/PannableGrid";

// minimal image input for masonry
export type MasonryImage = {
  id?: string | number;
  /** Either provide (natural) width+height OR aspectRatio */
  width?: number;      // natural width
  height?: number;     // natural height
  aspectRatio?: number; // width / height
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
    const ar =
      img.aspectRatio ??
      (img.width && img.height ? img.width / img.height : undefined);
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

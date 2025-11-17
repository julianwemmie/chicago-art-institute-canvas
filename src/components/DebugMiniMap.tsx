import styles from './PannableGrid.module.css';
import type { GridItem, Viewport } from './pannableTypes';

type MiniMapProps = {
  debug?: boolean;
  currentItems: GridItem[];
  view: Viewport;
  minimapSize: number;
  itemSize: number;
};

export const DebugMiniMap = ({
  debug,
  currentItems,
  view,
  minimapSize,
  itemSize,
}: MiniMapProps) => {
  if (!debug) return null;
  if (!currentItems.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  currentItems.forEach((item) => {
    if (item.x < minX) minX = item.x;
    if (item.y < minY) minY = item.y;
    if (item.x > maxX) maxX = item.x;
    if (item.y > maxY) maxY = item.y;
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min(minimapSize / spanX, minimapSize / spanY);
  const contentWidth = spanX * scale;
  const contentHeight = spanY * scale;
  const offsetX = (minimapSize - contentWidth) / 2;
  const offsetY = (minimapSize - contentHeight) / 2;

  const clamp = (value: number, min: number, max: number) => {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  };

  const clampWithSize = (value: number, size: number) =>
    clamp(value, 0, Math.max(minimapSize - size, 0));
  const viewportWidth = Math.min(Math.max(view.width * scale, 2), minimapSize);
  const viewportHeight = Math.min(
    Math.max(view.height * scale, 2),
    minimapSize,
  );
  const viewportRect = {
    left: clampWithSize(offsetX + (view.x - minX) * scale, viewportWidth),
    top: clampWithSize(offsetY + (view.y - minY) * scale, viewportHeight),
    width: viewportWidth,
    height: viewportHeight,
  };

  return (
    <div className={styles.miniMap}>
      <div className={styles.miniMapContent}>
        {currentItems.map((item, index) => {
          const key = item.id ?? `${item.x}:${item.y}:${index}`;
          const left = offsetX + (item.x - minX) * scale - itemSize / 2;
          const top = offsetY + (item.y - minY) * scale - itemSize / 2;
          return (
            <div
              key={key}
              className={styles.miniMapItem}
              style={{
                left,
                top,
                width: itemSize,
                height: itemSize,
              }}
            />
          );
        })}
        <div
          className={styles.miniMapViewport}
          style={{
            left: viewportRect.left,
            top: viewportRect.top,
            width: viewportRect.width,
            height: viewportRect.height,
          }}
        />
      </div>
    </div>
  );
};

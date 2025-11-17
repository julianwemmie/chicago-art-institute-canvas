import type { ReactNode } from 'react';
import styles from './PannableGrid.module.css';
import { cx } from '../lib/cx';
import type { Camera, Viewport } from './pannableTypes';

type DebugOverlayProps = {
  debug?: boolean;
  view: Viewport;
  overscan: number;
  renderBase: Camera;
  transform: string;
  gridSpacing: number;
};

export const DebugOverlay = ({
  debug,
  view,
  overscan,
  renderBase,
  transform,
  gridSpacing,
}: DebugOverlayProps) => {
  if (!debug) return null;

  const lines: ReactNode[] = [];
  const labels: ReactNode[] = [];
  const xStart =
    Math.floor((view.x - overscan) / gridSpacing) * gridSpacing;
  const xEnd = view.x + view.width + overscan;
  const labelTop = view.y - renderBase.y + 4;
  const labelLeft = view.x - renderBase.x + 4;

  for (let x = xStart; x <= xEnd; x += gridSpacing) {
    const left = x - renderBase.x;
    lines.push(
      <div
        key={`vx-${x}`}
        className={cx(styles.gridLine, styles.gridLineY)}
        style={{ left }}
      />,
    );
    labels.push(
      <div
        key={`lx-${x}`}
        className={styles.gridLabel}
        style={{ left, top: labelTop }}
      >
        x={x}
      </div>,
    );
  }

  const yStart =
    Math.floor((view.y - overscan) / gridSpacing) * gridSpacing;
  const yEnd = view.y + view.height + overscan;

  for (let y = yStart; y <= yEnd; y += gridSpacing) {
    const top = y - renderBase.y;
    lines.push(
      <div
        key={`hy-${y}`}
        className={cx(styles.gridLine, styles.gridLineX)}
        style={{ top }}
      />,
    );
    labels.push(
      <div
        key={`ly-${y}`}
        className={styles.gridLabel}
        style={{ top, left: labelLeft }}
      >
        y={y}
      </div>,
    );
  }

  return (
    <div className={styles.debugLayer} style={{ transform }}>
      {lines}
      {labels}
    </div>
  );
};

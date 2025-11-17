import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import styles from './PannableGrid.module.css';
import { cx } from '../lib/cx';
import { DebugOverlay } from './DebugOverlay';
import { DebugMiniMap } from './DebugMiniMap';
import type {
  Camera,
  DataFn,
  GridItem,
  Viewport,
} from './pannableTypes';
import { useCameraController } from '../hooks/useCameraController';
import { usePointerPan } from '../hooks/usePointerPan';
import { useGridItems } from '../hooks/useGridItems';

export type { GridItem, Viewport } from './pannableTypes';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const GRID_SPACING = 200;
const MINIMAP_SIZE = 150;
const MINIMAP_ITEM_SIZE = 4;
const DEFAULT_MIN_ZOOM_PERCENT = 50;
const DEFAULT_MAX_ZOOM_PERCENT = 200;
const DEFAULT_INITIAL_ZOOM_PERCENT = 100;
const ZOOM_WHEEL_SENSITIVITY = 0.006;

export type PannableGridProps = {
  items?: GridItem[];
  getItems?: DataFn;
  initialOffset?: { x?: number; y?: number };
  debug?: boolean;
  onCameraChange?: (camera: Camera) => void;
  className?: string;
  worldClassName?: string;
  overscan?: number;
  recenterThreshold?: number;
  minZoomPercent?: number;
  maxZoomPercent?: number;
  initialZoomPercent?: number;
};

export type PannableGridHandle = {
  getCamera(): Camera;
  setCamera(x: number, y: number): void;
  panBy(dx: number, dy: number): void;
};

export const PannableGrid = forwardRef<PannableGridHandle, PannableGridProps>(
  (
    {
      items,
      getItems,
      initialOffset,
      debug = false,
      onCameraChange,
      className,
      worldClassName,
      overscan = 400,
      recenterThreshold = 10000,
      minZoomPercent = DEFAULT_MIN_ZOOM_PERCENT,
      maxZoomPercent = DEFAULT_MAX_ZOOM_PERCENT,
      initialZoomPercent = DEFAULT_INITIAL_ZOOM_PERCENT,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

    const {
      camera,
      cameraRef,
      zoom,
      zoomRef,
      view,
      renderBase,
      transform,
      schedulePan,
      applyZoom,
      setCameraState,
      resetPendingPan,
    } = useCameraController({
      initialOffset,
      recenterThreshold,
      minZoomPercent,
      maxZoomPercent,
      initialZoomPercent,
      viewportSize,
    });

    const {
      dragging,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handlePointerCancel,
      handlePointerCaptureLost,
    } = usePointerPan({
      containerRef,
      zoomRef,
      schedulePan,
      applyZoom,
      setCameraState,
    });

    useIsomorphicLayoutEffect(() => {
      const node = containerRef.current;
      if (!node || typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        setViewportSize((prev) => {
          if (prev.width === width && prev.height === height) {
            return prev;
          }
          return { width, height };
        });
      });
      observer.observe(node);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const handleWheel = (event: WheelEvent) => {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          const rect = el.getBoundingClientRect();
          const origin = rect
            ? {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
              }
            : undefined;
          const zoomScale = Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY);
          const nextPercent = zoomRef.current * zoomScale * 100;
          applyZoom(nextPercent, origin);
          return;
        }
        const currentZoom = zoomRef.current;
        schedulePan(event.deltaX / currentZoom, event.deltaY / currentZoom);
      };
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => {
        el.removeEventListener('wheel', handleWheel);
      };
    }, [applyZoom, schedulePan]);

    const expandedView: Viewport = useMemo(
      () => ({
        x: view.x - overscan,
        y: view.y - overscan,
        width: view.width + overscan * 2,
        height: view.height + overscan * 2,
      }),
      [overscan, view],
    );
    
    const hasViewport = viewportSize.width > 0 && viewportSize.height > 0;

    const { currentItems, renderableItems } = useGridItems({
      items,
      getItems,
      view,
      expandedView,
      hasViewport,
    });

    useEffect(() => {
      if (!onCameraChange) return;
      onCameraChange(camera);
    }, [camera, onCameraChange]);

    useImperativeHandle(
      ref,
      (): PannableGridHandle => ({
        getCamera: () => ({ ...cameraRef.current }),
        setCamera: (x, y) => {
          resetPendingPan();
          setCameraState({ x, y });
        },
        panBy: (dx, dy) => {
          schedulePan(dx, dy);
        },
      }),
      [cameraRef, resetPendingPan, schedulePan, setCameraState],
    );

    return (
      <div
        ref={containerRef}
        className={cx(styles.wrapper, className, dragging && styles.dragging)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCaptureLost}
      >
        <div
          className={cx(styles.world, worldClassName)}
          style={{ transform }}
        >
          {renderableItems.map((item, index) => {
            const key = item.id ?? `${item.x}:${item.y}:${index}`;
            return (
              <div
                key={key}
                className={styles.item}
                style={{
                  left: item.x - renderBase.x,
                  top: item.y - renderBase.y,
                }}
              >
                {item.content}
              </div>
            );
          })}
        </div>
        <DebugOverlay
          debug={debug}
          view={view}
          overscan={overscan}
          renderBase={renderBase}
          transform={transform}
          gridSpacing={GRID_SPACING}
        />
        <DebugMiniMap
          debug={debug}
          currentItems={currentItems}
          view={view}
          minimapSize={MINIMAP_SIZE}
          itemSize={MINIMAP_ITEM_SIZE}
        />
      </div>
    );
  },
);

PannableGrid.displayName = 'PannableGrid';

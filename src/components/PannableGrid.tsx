import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import styles from './PannableGrid.module.css';

/**
 * Static items example
 *
 * <PannableGrid
 *   items={[
 *     { id: 1, x: 0, y: 0, content: <div>Origin</div> },
 *     { id: 2, x: 500, y: 300, content: <img src="/cat.png" /> },
 *   ]}
 *   debug
 * />
 *
 * Async data function example
 *
 * const getItems = (view: Viewport, prevView: Viewport) => {
 *   return queryItems(view, prevView);
 * };
 *
 * <PannableGrid getItems={getItems} overscan={600} />
 */

const cx = (...classes: Array<string | undefined | false>) =>
  classes.filter(Boolean).join(' ');

export type GridItem = {
  id?: string | number;
  x: number;
  y: number;
  content: React.ReactNode;
};

export type GridDataResult =
  | GridItem[]
  | {
      items?: GridItem[];
      debugItems?: GridItem[];
    };

export type Viewport = { x: number; y: number; width: number; height: number };

type DataFn = (
  view: Viewport,
  prevView: Viewport,
) => GridDataResult | Promise<GridDataResult>;

export type PannableGridProps = {
  items?: GridItem[];
  getItems?: DataFn;
  initialOffset?: { x?: number; y?: number };
  debug?: boolean;
  onCameraChange?: (camera: { x: number; y: number }) => void;
  className?: string;
  worldClassName?: string;
  overscan?: number;
  recenterThreshold?: number;
};

export type PannableGridHandle = {
  getCamera(): { x: number; y: number };
  setCamera(x: number, y: number): void;
  panBy(dx: number, dy: number): void;
};

type Camera = { x: number; y: number };

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const GRID_SPACING = 200;
const MINIMAP_SIZE = 150;
const MINIMAP_ITEM_SIZE = 4;

const normalizeGridDataResult = (
  result: GridDataResult | undefined,
): { items: GridItem[]; debugItems: GridItem[] } => {
  if (!result) {
    return { items: [], debugItems: [] };
  }
  if (Array.isArray(result)) {
    return { items: result, debugItems: result };
  }
  const items = result.items ?? [];
  const debugItems = result.debugItems ?? items;
  return { items, debugItems };
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
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const cameraRef = useRef<Camera>({
      x: initialOffset?.x ?? 0,
      y: initialOffset?.y ?? 0,
    });
    const [camera, setCamera] = useState<Camera>(cameraRef.current);
    const renderBaseRef = useRef<Camera>({ x: 0, y: 0 });
    const [, forceBaseUpdate] = useState(0);

    const [viewportSize, setViewportSize] = useState({
      width: 0,
      height: 0,
    });

    useEffect(() => {
      cameraRef.current = camera;
    }, [camera]);

    const applyRecenter = useCallback(
      (nextCamera: Camera) => {
        const base = renderBaseRef.current;
        let changed = false;
        const nextBase = { ...base };
        if (Math.abs(nextCamera.x - base.x) > recenterThreshold) {
          nextBase.x = nextCamera.x;
          changed = true;
        }
        if (Math.abs(nextCamera.y - base.y) > recenterThreshold) {
          nextBase.y = nextCamera.y;
          changed = true;
        }
        if (changed) {
          renderBaseRef.current = nextBase;
          forceBaseUpdate((v) => v + 1);
        }
        return nextCamera;
      },
      [recenterThreshold],
    );

    const setCameraState = useCallback(
      (updater: Camera | ((prev: Camera) => Camera)) => {
        setCamera((prev) => {
          const next =
            typeof updater === 'function'
              ? (updater as (prev: Camera) => Camera)(prev)
              : updater;
          return applyRecenter(next);
        });
      },
      [applyRecenter],
    );

    const pendingPanRef = useRef({ dx: 0, dy: 0 });
    const rafRef = useRef<number | null>(null);

    const flushPan = useCallback(() => {
      rafRef.current = null;
      const { dx, dy } = pendingPanRef.current;
      if (!dx && !dy) return;
      pendingPanRef.current = { dx: 0, dy: 0 };
      setCameraState((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    }, [setCameraState]);

    const schedulePan = useCallback(
      (dx: number, dy: number) => {
        pendingPanRef.current.dx += dx;
        pendingPanRef.current.dy += dy;
        if (rafRef.current == null) {
          rafRef.current =
            typeof window !== 'undefined'
              ? window.requestAnimationFrame(flushPan)
              : null;
        }
      },
      [flushPan],
    );

    useEffect(
      () => () => {
        if (rafRef.current != null && typeof window !== 'undefined') {
          window.cancelAnimationFrame(rafRef.current);
        }
      },
      [],
    );

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
        schedulePan(event.deltaX, event.deltaY);
      };
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => {
        el.removeEventListener('wheel', handleWheel);
      };
    }, [schedulePan]);

    const dragStateRef = useRef<{
      pointerId: number;
      lastX: number;
      lastY: number;
    } | null>(null);
    const [dragging, setDragging] = useState(false);

    const handlePointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        const node = containerRef.current;
        if (!node) return;
        event.preventDefault();
        node.setPointerCapture(event.pointerId);
        dragStateRef.current = {
          pointerId: event.pointerId,
          lastX: event.clientX,
          lastY: event.clientY,
        };
        setDragging(true);
      },
      [],
    );

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragStateRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        const dx = event.clientX - drag.lastX;
        const dy = event.clientY - drag.lastY;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        schedulePan(-dx, -dy);
      },
      [schedulePan],
    );

    const endDrag = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragStateRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const node = containerRef.current;
        node?.releasePointerCapture(event.pointerId);
        dragStateRef.current = null;
        setDragging(false);
      },
      [],
    );

    const handlePointerCaptureLost = useCallback(() => {
      dragStateRef.current = null;
      setDragging(false);
    }, []);

    const view: Viewport = useMemo(
      () => ({
        x: camera.x,
        y: camera.y,
        width: viewportSize.width,
        height: viewportSize.height,
      }),
      [camera, viewportSize],
    );

    const expandedView: Viewport = useMemo(
      () => ({
        x: view.x - overscan,
        y: view.y - overscan,
        width: view.width + overscan * 2,
        height: view.height + overscan * 2,
      }),
      [view, overscan],
    );

    const useDataFn = Boolean(getItems);
    const [dynamicItems, setDynamicItems] = useState<GridItem[]>([]);
    const [debugItems, setDebugItems] = useState<GridItem[]>([]);
    const getItemsRef = useRef(getItems);
    const prevViewRef = useRef<Viewport | null>(null);

    useEffect(() => {
      getItemsRef.current = getItems;
    }, [getItems]);

    const requestIdRef = useRef(0);
    const hasViewport = viewportSize.width > 0 && viewportSize.height > 0;

    useEffect(() => {
      if (!getItemsRef.current) return;
      if (!hasViewport) return;

      const currentRequest = ++requestIdRef.current;
      const prevView = prevViewRef.current ?? view;
      prevViewRef.current = view;
      const maybe = getItemsRef.current?.(view, prevView);
      const handleResult = (result: GridDataResult | undefined) => {
        if (currentRequest !== requestIdRef.current) return;
        const normalized = normalizeGridDataResult(result);
        setDynamicItems(normalized.items);
        setDebugItems(normalized.debugItems);
      };
      if (maybe && typeof (maybe as Promise<GridDataResult>).then === 'function') {
        (maybe as Promise<GridDataResult>)
          .then(handleResult)
          .catch(() => {
            if (currentRequest === requestIdRef.current) {
              setDynamicItems([]);
              setDebugItems([]);
            }
          });
      } else {
        handleResult(maybe as GridDataResult | undefined);
      }
    }, [expandedView, hasViewport, getItems]);

    const currentItems = useMemo(
      () => (useDataFn ? dynamicItems : items ?? []),
      [useDataFn, dynamicItems, items],
    );

    const debugMiniMapItems = useMemo(
      () => (useDataFn ? debugItems : items ?? []),
      [useDataFn, debugItems, items],
    );

    const renderableItems = useMemo(() => {
      const source = currentItems;
      if (!source.length) return [];
      const xMin = expandedView.x;
      const xMax = expandedView.x + expandedView.width;
      const yMin = expandedView.y;
      const yMax = expandedView.y + expandedView.height;
      return source.filter(
        (item) =>
          item.x >= xMin &&
          item.x <= xMax &&
          item.y >= yMin &&
          item.y <= yMax,
      );
    }, [currentItems, expandedView]);

    useEffect(() => {
      if (!onCameraChange) return;
      onCameraChange(camera);
    }, [camera, onCameraChange]);

    useImperativeHandle(
      ref,
      (): PannableGridHandle => ({
        getCamera: () => ({ ...cameraRef.current }),
        setCamera: (x, y) => {
          pendingPanRef.current = { dx: 0, dy: 0 };
          setCameraState({ x, y });
        },
        panBy: (dx, dy) => {
          schedulePan(dx, dy);
        },
      }),
      [schedulePan, setCameraState],
    );

    const renderBase = renderBaseRef.current;
    const transform = `translate3d(${renderBase.x - camera.x}px, ${
      renderBase.y - camera.y
    }px, 0)`;

    const renderDebug = () => {
      if (!debug) return null;
      const lines: React.ReactNode[] = [];
      const labels: React.ReactNode[] = [];
      const xStart =
        Math.floor((view.x - overscan) / GRID_SPACING) * GRID_SPACING;
      const xEnd = view.x + view.width + overscan;
      const labelTop = view.y - renderBase.y + 4;
      const labelLeft = view.x - renderBase.x + 4;
      for (let x = xStart; x <= xEnd; x += GRID_SPACING) {
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
        Math.floor((view.y - overscan) / GRID_SPACING) * GRID_SPACING;
      const yEnd = view.y + view.height + overscan;
      for (let y = yStart; y <= yEnd; y += GRID_SPACING) {
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

    const renderMiniMap = () => {
      if (!debug) return null;
      if (!debugMiniMapItems.length) return null;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      debugMiniMapItems.forEach((item) => {
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
      const scale = Math.min(MINIMAP_SIZE / spanX, MINIMAP_SIZE / spanY);
      const contentWidth = spanX * scale;
      const contentHeight = spanY * scale;
      const offsetX = (MINIMAP_SIZE - contentWidth) / 2;
      const offsetY = (MINIMAP_SIZE - contentHeight) / 2;

      const clamp = (value: number, min: number, max: number) => {
        if (value < min) return min;
        if (value > max) return max;
        return value;
      };

      const clampWithSize = (value: number, size: number) =>
        clamp(value, 0, Math.max(MINIMAP_SIZE - size, 0));
      const viewportWidth = Math.min(Math.max(view.width * scale, 2), MINIMAP_SIZE);
      const viewportHeight = Math.min(Math.max(view.height * scale, 2), MINIMAP_SIZE);
      const viewportRect = {
        left: clampWithSize(offsetX + (view.x - minX) * scale, viewportWidth),
        top: clampWithSize(offsetY + (view.y - minY) * scale, viewportHeight),
        width: viewportWidth,
        height: viewportHeight,
      };

      return (
        <div className={styles.miniMap}>
          <div className={styles.miniMapContent}>
            {debugMiniMapItems.map((item, index) => {
              const key = item.id ?? `${item.x}:${item.y}:${index}`;
              const left = offsetX + (item.x - minX) * scale - MINIMAP_ITEM_SIZE / 2;
              const top = offsetY + (item.y - minY) * scale - MINIMAP_ITEM_SIZE / 2;
              return (
                <div
                  key={key}
                  className={styles.miniMapItem}
                  style={{
                    left,
                    top,
                    width: MINIMAP_ITEM_SIZE,
                    height: MINIMAP_ITEM_SIZE,
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

    return (
      <div
        ref={containerRef}
        className={cx(styles.wrapper, className, dragging && styles.dragging)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
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
        {renderDebug()}
        {renderMiniMap()}
      </div>
    );
  },
);

PannableGrid.displayName = 'PannableGrid';

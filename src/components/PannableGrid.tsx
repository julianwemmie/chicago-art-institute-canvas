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

export type Viewport = { x: number; y: number; width: number; height: number };

type DataFn = (
  view: Viewport,
  prevView: Viewport,
) => GridItem[] | Promise<GridItem[]>;

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
      const handleResult = (result: GridItem[] | undefined) => {
        if (currentRequest !== requestIdRef.current) return;
        setDynamicItems(result ?? []);
      };
      if (maybe && typeof (maybe as Promise<GridItem[]>).then === 'function') {
        (maybe as Promise<GridItem[]>)
          .then(handleResult)
          .catch(() => {
            if (currentRequest === requestIdRef.current) {
              setDynamicItems([]);
            }
          });
      } else {
        handleResult(maybe as GridItem[] | undefined);
      }
    }, [expandedView, hasViewport, getItems]);

    const renderableItems = useMemo(() => {
      const source = useDataFn ? dynamicItems : items ?? [];
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
    }, [useDataFn, dynamicItems, items, expandedView]);

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
      </div>
    );
  },
);

PannableGrid.displayName = 'PannableGrid';

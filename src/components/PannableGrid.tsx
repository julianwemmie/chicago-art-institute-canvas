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
 * <PannableGrid
 *   getItems={getItems}
 *   overscan={600}
 *   minZoomPercent={50}
 *   maxZoomPercent={175}
 * />
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
  minZoomPercent?: number;
  maxZoomPercent?: number;
  initialZoomPercent?: number;
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
const INERTIA_DECAY = 0.004;
const VELOCITY_EPSILON = 0.02;
const STILLNESS_TIMEOUT_MS = 120;
const DEFAULT_MIN_ZOOM_PERCENT = 50;
const DEFAULT_MAX_ZOOM_PERCENT = 200;
const DEFAULT_INITIAL_ZOOM_PERCENT = 100;
const ZOOM_WHEEL_SENSITIVITY = 0.0060;

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
    const [dragging, setDragging] = useState(false);
    const activePointersRef = useRef<
      Map<number, { x: number; y: number; pointerType: string }>
    >(new Map());
    const pinchStateRef = useRef<{
      pointerIds: [number, number];
      initialDistance: number;
      initialZoomPercent: number;
      origin?: { x: number; y: number };
      lastFocus?: { x: number; y: number };
    } | null>(null);
    const zoomLimits = useMemo(() => {
      const safeMin = Math.max(minZoomPercent, 1);
      const safeMax = Math.max(maxZoomPercent, 1);
      const min = Math.min(safeMin, safeMax);
      const max = Math.max(safeMin, safeMax);
      return { min, max };
    }, [minZoomPercent, maxZoomPercent]);
    const clampZoomPercent = useCallback(
      (value: number) => {
        if (!Number.isFinite(value)) {
          return zoomLimits.min;
        }
        if (value < zoomLimits.min) return zoomLimits.min;
        if (value > zoomLimits.max) return zoomLimits.max;
        return value;
      },
      [zoomLimits],
    );
    const [zoomPercent, setZoomPercent] = useState(() =>
      clampZoomPercent(initialZoomPercent),
    );
    const zoom = zoomPercent / 100;
    const zoomRef = useRef(zoom);

    useEffect(() => {
      zoomRef.current = zoom;
    }, [zoom]);

    useEffect(() => {
      setZoomPercent((prev) => clampZoomPercent(prev));
    }, [clampZoomPercent]);

    useEffect(() => {
      cameraRef.current = camera;
    }, [camera]);

    const updatePointerInfo = useCallback(
      (event: { pointerId: number; clientX: number; clientY: number; pointerType: string }) => {
        activePointersRef.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
          pointerType: event.pointerType,
        });
      },
      [],
    );

    const removePointerInfo = useCallback((pointerId: number) => {
      activePointersRef.current.delete(pointerId);
    }, []);

    const tryStartPinch = useCallback(() => {
      if (pinchStateRef.current) return;
      const touches = Array.from(activePointersRef.current.entries()).filter(
        ([, info]) => info.pointerType === 'touch',
      );
      if (touches.length < 2) return;
      const [firstId, firstInfo] = touches[touches.length - 2];
      const [secondId, secondInfo] = touches[touches.length - 1];
      if (!firstInfo || !secondInfo) {
        return;
      }
      const initialDistance = Math.hypot(
        secondInfo.x - firstInfo.x,
        secondInfo.y - firstInfo.y,
      );
      if (initialDistance < 1) return;
      const rect = containerRef.current?.getBoundingClientRect();
      const origin = rect
        ? {
            x: (firstInfo.x + secondInfo.x) / 2 - rect.left,
            y: (firstInfo.y + secondInfo.y) / 2 - rect.top,
          }
        : undefined;
      pinchStateRef.current = {
        pointerIds: [firstId, secondId],
        initialDistance,
        initialZoomPercent: zoomRef.current * 100,
        origin,
        lastFocus: origin,
      };
      dragStateRef.current = null;
      setDragging(false);
    }, [setDragging]);

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

    const applyZoom = useCallback(
      (nextPercent: number, origin?: { x: number; y: number }) => {
        const targetPercent = clampZoomPercent(nextPercent);
        const currentZoom = zoomRef.current;
        const nextZoom = targetPercent / 100;
        if (nextZoom === currentZoom) {
          return;
        }
        const fallbackFocus = {
          x: viewportSize.width / 2,
          y: viewportSize.height / 2,
        };
        const focus = origin ?? fallbackFocus;
        setCameraState((prev) => {
          const worldFocusX = prev.x + focus.x / currentZoom;
          const worldFocusY = prev.y + focus.y / currentZoom;
          return {
            x: worldFocusX - focus.x / nextZoom,
            y: worldFocusY - focus.y / nextZoom,
          };
        });
        setZoomPercent(targetPercent);
      },
      [clampZoomPercent, setCameraState, viewportSize.height, viewportSize.width],
    );

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

    const dragStateRef = useRef<{
      pointerId: number;
      lastX: number;
      lastY: number;
      lastTime: number;
    } | null>(null);
    const velocityRef = useRef({ vx: 0, vy: 0 });
    const inertiaFrameRef = useRef<number | null>(null);
    const inertiaStateRef = useRef<{
      vx: number;
      vy: number;
      lastTime: number;
    } | null>(null);

    const stopInertia = useCallback(() => {
      inertiaStateRef.current = null;
      if (
        inertiaFrameRef.current != null &&
        typeof window !== 'undefined'
      ) {
        window.cancelAnimationFrame(inertiaFrameRef.current);
      }
      inertiaFrameRef.current = null;
    }, []);

    const runInertiaFrame = useCallback(() => {
      const state = inertiaStateRef.current;
      if (!state || typeof window === 'undefined') {
        return;
      }
      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const dt = Math.min(now - state.lastTime, 1000 / 30);
      state.lastTime = now;
      const damping = Math.exp(-INERTIA_DECAY * dt);
      state.vx *= damping;
      state.vy *= damping;
      if (
        Math.abs(state.vx) < VELOCITY_EPSILON &&
        Math.abs(state.vy) < VELOCITY_EPSILON
      ) {
        stopInertia();
        return;
      }
      schedulePan(state.vx * dt, state.vy * dt);
      inertiaFrameRef.current = window.requestAnimationFrame(runInertiaFrame);
    }, [schedulePan, stopInertia]);

    const startInertia = useCallback(() => {
      stopInertia();
      const { vx, vy } = velocityRef.current;
      const speed = Math.hypot(vx, vy);
      if (speed < VELOCITY_EPSILON) {
        return;
      }
      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      inertiaStateRef.current = { vx, vy, lastTime: now };
      if (typeof window === 'undefined') {
        return;
      }
      inertiaFrameRef.current = window.requestAnimationFrame(runInertiaFrame);
    }, [runInertiaFrame, stopInertia]);

    useEffect(
      () => () => {
        if (rafRef.current != null && typeof window !== 'undefined') {
          window.cancelAnimationFrame(rafRef.current);
        }
        stopInertia();
      },
      [stopInertia],
    );

    const handlePointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 && event.pointerType !== 'touch') return;
        const node = containerRef.current;
        if (!node) return;
        event.preventDefault();
        node.setPointerCapture(event.pointerId);
        stopInertia();
        if (event.pointerType === 'touch') {
          updatePointerInfo(event);
          tryStartPinch();
          if (pinchStateRef.current) {
            return;
          }
        }
        velocityRef.current = { vx: 0, vy: 0 };
        dragStateRef.current = {
          pointerId: event.pointerId,
          lastX: event.clientX,
          lastY: event.clientY,
          lastTime:
            typeof performance !== 'undefined'
              ? performance.now()
              : Date.now(),
        };
        setDragging(true);
      },
      [stopInertia, tryStartPinch, updatePointerInfo],
    );

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType === 'touch') {
          updatePointerInfo(event);
        }
        const pinch = pinchStateRef.current;
        if (pinch) {
          const first = activePointersRef.current.get(pinch.pointerIds[0]);
          const second = activePointersRef.current.get(pinch.pointerIds[1]);
          if (!first || !second) {
            pinchStateRef.current = null;
            return;
          }
          event.preventDefault();
          const rect = containerRef.current?.getBoundingClientRect();
          const origin =
            rect != null
              ? {
                  x: (first.x + second.x) / 2 - rect.left,
                  y: (first.y + second.y) / 2 - rect.top,
                }
              : pinch.lastFocus ?? pinch.origin;
          if (!origin) {
            return;
          }
          if (pinch.lastFocus) {
            const currentZoom = zoomRef.current;
            const focusDx = origin.x - pinch.lastFocus.x;
            const focusDy = origin.y - pinch.lastFocus.y;
            if (focusDx || focusDy) {
              setCameraState((prev) => ({
                x: prev.x - focusDx / currentZoom,
                y: prev.y - focusDy / currentZoom,
              }));
            }
          }
          pinch.lastFocus = origin;
          const distance = Math.hypot(second.x - first.x, second.y - first.y);
          if (distance > 0) {
            const scale = distance / pinch.initialDistance;
            const nextPercent = pinch.initialZoomPercent * scale;
            applyZoom(nextPercent, origin);
          }
          return;
        }
        const drag = dragStateRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        const dx = event.clientX - drag.lastX;
        const dy = event.clientY - drag.lastY;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        const currentZoom = zoomRef.current;
        const panDx = -dx / currentZoom;
        const panDy = -dy / currentZoom;
        schedulePan(panDx, panDy);
        const now =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        const dt = Math.max(now - drag.lastTime, 1);
        drag.lastTime = now;
        const smoothing = 0.2;
        velocityRef.current.vx =
          velocityRef.current.vx * (1 - smoothing) + (panDx / dt) * smoothing;
        velocityRef.current.vy =
          velocityRef.current.vy * (1 - smoothing) + (panDy / dt) * smoothing;
      },
      [applyZoom, schedulePan, setCameraState, updatePointerInfo],
    );

    const endDrag = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const node = containerRef.current;
        node?.releasePointerCapture(event.pointerId);
        if (event.pointerType === 'touch') {
          removePointerInfo(event.pointerId);
        }
        if (pinchStateRef.current?.pointerIds.includes(event.pointerId)) {
          pinchStateRef.current = null;
          return;
        }
        const drag = dragStateRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragStateRef.current = null;
        const now =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now - drag.lastTime > STILLNESS_TIMEOUT_MS) {
          velocityRef.current = { vx: 0, vy: 0 };
        }
        setDragging(false);
        startInertia();
      },
      [removePointerInfo, setDragging, startInertia],
    );

    const handlePointerCaptureLost = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType === 'touch') {
          removePointerInfo(event.pointerId);
        }
        if (pinchStateRef.current?.pointerIds.includes(event.pointerId)) {
          pinchStateRef.current = null;
        }
        dragStateRef.current = null;
        setDragging(false);
      },
      [removePointerInfo, setDragging],
    );

    const view: Viewport = useMemo(
      () => ({
        x: camera.x,
        y: camera.y,
        width: viewportSize.width / zoom,
        height: viewportSize.height / zoom,
      }),
      [camera, viewportSize, zoom],
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
        if (!result) {
          setDynamicItems([]);
          return;
        }
        setDynamicItems(result);
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

    const currentItems = useMemo(
      () => (useDataFn ? dynamicItems : items ?? []),
      [useDataFn, dynamicItems, items],
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
    const transform = `scale(${zoom}) translate3d(${renderBase.x - camera.x}px, ${
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
            {currentItems.map((item, index) => {
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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Camera } from '../components/pannableTypes';

type ViewportSize = { width: number; height: number };

type UseCameraControllerOptions = {
  initialOffset?: { x?: number; y?: number };
  recenterThreshold: number;
  minZoomPercent: number;
  maxZoomPercent: number;
  initialZoomPercent: number;
  viewportSize: ViewportSize;
};

export type SetCameraState = (
  updater: Camera | ((prev: Camera) => Camera),
) => void;

export const useCameraController = ({
  initialOffset,
  recenterThreshold,
  minZoomPercent,
  maxZoomPercent,
  initialZoomPercent,
  viewportSize,
}: UseCameraControllerOptions) => {
  const cameraRef = useRef<Camera>({
    x: initialOffset?.x ?? 0,
    y: initialOffset?.y ?? 0,
  });
  const [camera, setCamera] = useState<Camera>(cameraRef.current);
  const renderBaseRef = useRef<Camera>({ x: 0, y: 0 });
  const [renderBaseVersion, forceBaseUpdate] = useState(0);

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

  const setCameraState: SetCameraState = useCallback(
    (updater) => {
      setCamera((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (prevCamera: Camera) => Camera)(prev)
            : updater;
        return applyRecenter(next);
      });
    },
    [applyRecenter],
  );

  const pendingPanRef = useRef({ dx: 0, dy: 0 });
  const rafRef = useRef<number | null>(null);

  const resetPendingPan = useCallback(() => {
    pendingPanRef.current = { dx: 0, dy: 0 };
  }, []);

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
      if (rafRef.current == null && typeof window !== 'undefined') {
        rafRef.current = window.requestAnimationFrame(flushPan);
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
    [
      clampZoomPercent,
      setCameraState,
      viewportSize.height,
      viewportSize.width,
    ],
  );

  const view = useMemo(
    () => ({
      x: camera.x,
      y: camera.y,
      width: viewportSize.width / zoom,
      height: viewportSize.height / zoom,
    }),
    [camera, viewportSize.height, viewportSize.width, zoom],
  );

  const renderBase = renderBaseRef.current;
  const renderBaseX = renderBase.x;
  const renderBaseY = renderBase.y;
  const transform = useMemo(
    () =>
      `scale(${zoom}) translate3d(${renderBaseX - camera.x}px, ${
        renderBaseY - camera.y
      }px, 0)`,
    [camera.x, camera.y, zoom, renderBaseVersion, renderBaseX, renderBaseY],
  );

  return {
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
  };
};

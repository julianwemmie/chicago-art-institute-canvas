import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { SetCameraState } from './useCameraController';

const INERTIA_DECAY = 0.004;
const VELOCITY_EPSILON = 0.02;
const STILLNESS_TIMEOUT_MS = 120;

type DOMPointerEvent = globalThis.PointerEvent;

type PointerInfo = { x: number; y: number; pointerType: string };

type PinchState = {
  pointerIds: [number, number];
  initialDistance: number;
  initialZoomPercent: number;
  origin?: { x: number; y: number };
  lastFocus?: { x: number; y: number };
} | null;

type DragState = {
  pointerId: number;
  lastX: number;
  lastY: number;
  lastTime: number;
} | null;

type PointerPanOptions = {
  containerRef: RefObject<HTMLDivElement>;
  zoomRef: MutableRefObject<number>;
  schedulePan: (dx: number, dy: number) => void;
  applyZoom: (nextPercent: number, origin?: { x: number; y: number }) => void;
  setCameraState: SetCameraState;
};

export const usePointerPan = ({
  containerRef,
  zoomRef,
  schedulePan,
  applyZoom,
  setCameraState,
}: PointerPanOptions) => {
  const [dragging, setDragging] = useState(false);
  const activePointersRef = useRef<Map<number, PointerInfo>>(new Map());
  const pinchStateRef = useRef<PinchState>(null);
  const dragStateRef = useRef<DragState>(null);
  const velocityRef = useRef({ vx: 0, vy: 0 });
  const inertiaFrameRef = useRef<number | null>(null);
  const inertiaStateRef = useRef<{
    vx: number;
    vy: number;
    lastTime: number;
  } | null>(null);

  const updatePointerInfo = useCallback((event: DOMPointerEvent) => {
    activePointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType,
    });
  }, []);

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
  }, [containerRef, setDragging, zoomRef]);

  const stopInertia = useCallback(() => {
    inertiaStateRef.current = null;
    if (inertiaFrameRef.current != null && typeof window !== 'undefined') {
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

  useEffect(() => stopInertia, [stopInertia]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.pointerType !== 'touch') return;
      const node = containerRef.current;
      if (!node) return;
      event.preventDefault();
      node.setPointerCapture(event.pointerId);
      stopInertia();
      if (event.pointerType === 'touch') {
        updatePointerInfo(event.nativeEvent);
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
          typeof performance !== 'undefined' ? performance.now() : Date.now(),
      };
      setDragging(true);
    },
    [containerRef, setDragging, stopInertia, tryStartPinch, updatePointerInfo],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch') {
        updatePointerInfo(event.nativeEvent);
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
    [applyZoom, containerRef, schedulePan, setCameraState, updatePointerInfo, zoomRef],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
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
    [containerRef, removePointerInfo, setDragging, startInertia],
  );

  const handlePointerCaptureLost = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
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

  return {
    dragging,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp: endDrag,
    handlePointerCancel: endDrag,
    handlePointerCaptureLost,
  };
};

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const GRID_SPACING = 120;
const GRID_MAJOR_EVERY = 5;
const BOARD_CELLS = 200;
const BOARD_WIDTH = BOARD_CELLS * GRID_SPACING;
const BOARD_HEIGHT = BOARD_CELLS * GRID_SPACING;
const BOARD_CENTER_X = BOARD_WIDTH / 2;
const BOARD_CENTER_Y = BOARD_HEIGHT / 2;
const DRAG_THRESHOLD_PX = 4;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }

    let raf = null;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => {
        window.removeEventListener('resize', measure);
      };
    }

    const observer = new ResizeObserver(() => {
      if (raf) {
        cancelAnimationFrame(raf);
      }
      raf = requestAnimationFrame(measure);
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
      if (raf) {
        cancelAnimationFrame(raf);
      }
    };
  }, [ref]);

  return size;
}

export default function ArtworkGrid() {
  const viewportRef = useRef(null);
  const dragRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
    captured: false,
  });
  const offsetRef = useRef({ x: 0, y: 0 });

  const viewportSize = useElementSize(viewportRef);
  const hasCenteredRef = useRef(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  const clampPan = useCallback(
    (nextX, nextY) => {
      const maxX = 0;
      const maxY = 0;
      const minX = Math.min(0, viewportSize.width - BOARD_WIDTH);
      const minY = Math.min(0, viewportSize.height - BOARD_HEIGHT);
      return {
        x: clamp(nextX, minX, maxX),
        y: clamp(nextY, minY, maxY),
      };
    },
    [viewportSize.width, viewportSize.height]
  );

  useEffect(() => {
    setOffset((current) => clampPan(current.x, current.y));
  }, [clampPan]);

  useEffect(() => {
    if (hasCenteredRef.current || !viewportSize.width || !viewportSize.height) {
      return;
    }

    hasCenteredRef.current = true;
    const centeredX = (viewportSize.width - BOARD_WIDTH) / 2;
    const centeredY = (viewportSize.height - BOARD_HEIGHT) / 2;
    setOffset(clampPan(centeredX, centeredY));
  }, [viewportSize.width, viewportSize.height, clampPan]);

  const handlePointerDown = useCallback((event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    dragRef.current.active = true;
    dragRef.current.pointerId = event.pointerId;
    dragRef.current.startX = event.clientX;
    dragRef.current.startY = event.clientY;
    dragRef.current.originX = offsetRef.current.x;
    dragRef.current.originY = offsetRef.current.y;
    dragRef.current.moved = false;
    dragRef.current.captured = false;
  }, []);

  const handlePointerMove = useCallback(
    (event) => {
      const drag = dragRef.current;
      if (!drag.active || event.pointerId !== drag.pointerId) {
        return;
      }

      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;

      if (!drag.moved && Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD_PX) {
        drag.moved = true;
        setIsDragging(true);
        if (!drag.captured && viewportRef.current) {
          try {
            viewportRef.current.setPointerCapture(drag.pointerId);
            drag.captured = true;
          } catch (captureError) {
            // ignore capture issues
          }
        }
      }

      const nextX = drag.originX + deltaX;
      const nextY = drag.originY + deltaY;
      setOffset(clampPan(nextX, nextY));
    },
    [clampPan]
  );

  const endDrag = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag.active || event.pointerId !== drag.pointerId) {
      return;
    }

    drag.active = false;
    drag.pointerId = null;
    drag.startX = 0;
    drag.startY = 0;
    drag.originX = offsetRef.current.x;
    drag.originY = offsetRef.current.y;
    drag.moved = false;
    setIsDragging(false);

    if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId);
    }

    if (drag.captured) {
      drag.captured = false;
    }
  }, []);

  const handleWheel = useCallback(
    (event) => {
      if (event.ctrlKey) {
        return;
      }

      event.preventDefault();
      const deltaX = event.deltaX;
      const deltaY = event.deltaY;

      setOffset((prev) => clampPan(prev.x - deltaX, prev.y - deltaY));
    },
    [clampPan]
  );

  const frameClassName = [
    'artwork-viewport__frame',
    isDragging ? 'artwork-viewport__frame--dragging' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="artwork-viewport">
      <div
        ref={viewportRef}
        className={frameClassName}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={handleWheel}
        role="region"
        aria-label="Draggable canvas"
      >
        <section
          className="artwork-grid"
          style={{
            width: `${BOARD_WIDTH}px`,
            height: `${BOARD_HEIGHT}px`,
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
          }}
        >
          <div
            className="artwork-grid__lines"
            style={{
              '--grid-spacing': `${GRID_SPACING}px`,
              '--grid-major-spacing': `${GRID_SPACING * GRID_MAJOR_EVERY}px`,
            }}
          />
          <div
            className="artwork-grid__origin"
            style={{
              transform: `translate3d(${BOARD_CENTER_X}px, ${BOARD_CENTER_Y}px, 0)`,
            }}
          />
        </section>
      </div>
    </div>
  );
}

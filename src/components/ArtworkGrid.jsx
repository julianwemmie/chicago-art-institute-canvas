import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { initMasonry } from '../lib/masonry.js';

const COLUMN_WIDTH = 280;
const GUTTER_X = 12;
const GUTTER_Y = 12;
const TARGET_COLUMNS = 8;
const BOARD_MULTIPLIER = 1.6;
const DRAG_THRESHOLD_PX = 4;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const widthForColumns = (columns) =>
  columns * COLUMN_WIDTH + Math.max(0, columns - 1) * GUTTER_X;

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

function ArtworkTile({ artwork, onSelect }) {
  const aspectRatio =
    artwork.thumbnailWidth && artwork.thumbnailHeight
      ? `${artwork.thumbnailWidth}/${artwork.thumbnailHeight}`
      : undefined;

  return (
    <button
      type="button"
      className="artwork-tile"
      onClick={() => {onSelect(artwork)}}
      data-aspect={aspectRatio}
    >
      <img
        src={artwork.thumbnail}
        alt={artwork.title}
        loading="lazy"
        decoding="async"
      />
      <div className="artwork-tile__overlay">
        <h3>{artwork.title}</h3>
        <p>{artwork.artist}</p>
      </div>
    </button>
  );
}

ArtworkTile.propTypes = {
  artwork: PropTypes.shape({
    id: PropTypes.number.isRequired,
    title: PropTypes.string.isRequired,
    artist: PropTypes.string.isRequired,
    thumbnail: PropTypes.string,
    thumbnailWidth: PropTypes.number,
    thumbnailHeight: PropTypes.number,
  }).isRequired,
  onSelect: PropTypes.func.isRequired,
};

export default function ArtworkGrid({ artworks, onSelect }) {
  const viewportRef = useRef(null);
  const containerRef = useRef(null);
  const masonryRef = useRef(null);
  const dragRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
    preventClick: false,
    captured: false,
  });
  const offsetRef = useRef({ x: 0, y: 0 });

  const viewportSize = useElementSize(viewportRef);
  const contentSize = useElementSize(containerRef);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const gridWidth = useMemo(() => {
    const baseWidth = widthForColumns(TARGET_COLUMNS);
    const scaledWidth =
      viewportSize.width > 0 ? Math.round(viewportSize.width * BOARD_MULTIPLIER) : 0;
    return Math.max(baseWidth, scaledWidth || baseWidth);
  }, [viewportSize.width]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const controller = initMasonry({
      container: containerRef.current,
      itemSelector: '.artwork-tile',
      columnWidth: COLUMN_WIDTH,
      gutterX: GUTTER_X,
      gutterY: GUTTER_Y,
    });

    masonryRef.current = controller;

    return () => {
      controller.destroyMasonry();
      masonryRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (masonryRef.current) {
      masonryRef.current.relayout();
    }
  }, [artworks, gridWidth]);

  const clampPan = useCallback(
    (nextX, nextY) => {
      const maxX = 0;
      const maxY = 0;
      const minX = Math.min(0, viewportSize.width - contentSize.width);
      const minY = Math.min(0, viewportSize.height - contentSize.height);
      return {
        x: clamp(nextX, minX, maxX),
        y: clamp(nextY, minY, maxY),
      };
    },
    [viewportSize.width, viewportSize.height, contentSize.width, contentSize.height]
  );

  useEffect(() => {
    setOffset((current) => clampPan(current.x, current.y));
  }, [clampPan]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }

    const handleClickCapture = (event) => {
      if (dragRef.current.preventClick) {
        dragRef.current.preventClick = false;
        event.stopPropagation();
        event.preventDefault();
      }
    };

    viewport.addEventListener('click', handleClickCapture, true);
    return () => {
      viewport.removeEventListener('click', handleClickCapture, true);
    };
  }, []);

  const handlePointerDown = useCallback((event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    dragRef.current.active = true;
    dragRef.current.pointerId = event.pointerId;
    dragRef.current.startX = event.clientX;
    dragRef.current.startY = event.clientY;
    dragRef.current.originX = offsetRef.current.x;
    dragRef.current.originY = offsetRef.current.y;
    dragRef.current.moved = false;
    dragRef.current.preventClick = false;
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
        drag.preventClick = true;
        setIsDragging(true);
        if (!drag.captured && viewportRef.current) {
          try {
            viewportRef.current.setPointerCapture(drag.pointerId);
            drag.captured = true;
          } catch (captureError) {
            // ignore capture issues (e.g., pointer already released)
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

    const viewport = viewportRef.current;
    drag.active = false;
    drag.pointerId = null;
    drag.startX = 0;
    drag.startY = 0;
    drag.originX = offsetRef.current.x;
    drag.originY = offsetRef.current.y;
    setIsDragging(false);

    if (viewport?.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }

    if (!drag.moved) {
      drag.preventClick = false;
    }

    drag.moved = false;
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
        aria-label="Artwork viewport"
      >
        <section
          ref={containerRef}
          className="artwork-grid"
          aria-live="polite"
          style={{
            width: `${gridWidth}px`,
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
          }}
        >
          {artworks.map((artwork) => (
            <ArtworkTile
              key={artwork.id}
              artwork={artwork}
              onSelect={onSelect}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

ArtworkGrid.propTypes = {
  artworks: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
    })
  ).isRequired,
  onSelect: PropTypes.func.isRequired,
};

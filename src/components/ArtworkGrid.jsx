import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';

const TILE_WIDTH = 320;
const TILE_GAP = 24;
const BOARD_CELLS = 400;
const BOARD_UNIT = TILE_WIDTH + TILE_GAP;
const BOARD_WIDTH = BOARD_CELLS * BOARD_UNIT;
const BOARD_HEIGHT = BOARD_CELLS * BOARD_UNIT;
const BOARD_CENTER_X = BOARD_WIDTH / 2;
const BOARD_CENTER_Y = BOARD_HEIGHT / 2;
const DRAG_THRESHOLD_PX = 4;
const VISIBLE_BUFFER = 600;

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

function ArtworkTile({ artwork, onSelect, style }) {
  const aspectRatio =
    artwork.thumbnailWidth && artwork.thumbnailHeight
      ? `${artwork.thumbnailWidth}/${artwork.thumbnailHeight}`
      : undefined;

  return (
    <button
      type="button"
      className="artwork-tile"
      onClick={() => {
        onSelect(artwork);
      }}
      data-aspect={aspectRatio}
      style={style}
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
  style: PropTypes.object,
};

ArtworkTile.defaultProps = {
  style: undefined,
};

export default function ArtworkGrid({ placements, onSelect, onViewportChange }) {
  const viewportRef = useRef(null);
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

  const hasCenteredRef = useRef(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const resolvedPlacements = useMemo(
    () =>
      placements.map((placement) => ({
        ...placement,
        width: placement.width ?? TILE_WIDTH,
        height: placement.height ?? TILE_WIDTH,
        boardX: (placement.x ?? 0) + BOARD_CENTER_X,
        boardY: (placement.y ?? 0) + BOARD_CENTER_Y,
      })),
    [placements]
  );

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

  const viewBounds = useMemo(() => {
    const left = -offset.x;
    const top = -offset.y;
    const right = left + viewportSize.width;
    const bottom = top + viewportSize.height;
    return { left, top, right, bottom };
  }, [offset.x, offset.y, viewportSize.width, viewportSize.height]);

  const worldBounds = useMemo(
    () => ({
      left: viewBounds.left - BOARD_CENTER_X,
      right: viewBounds.right - BOARD_CENTER_X,
      top: viewBounds.top - BOARD_CENTER_Y,
      bottom: viewBounds.bottom - BOARD_CENTER_Y,
    }),
    [viewBounds]
  );

  useEffect(() => {
    if (onViewportChange) {
      onViewportChange(worldBounds);
    }
  }, [onViewportChange, worldBounds]);

  const visiblePlacements = useMemo(() => {
    if (!viewportSize.width || !viewportSize.height) {
      return [];
    }

    const buffer = VISIBLE_BUFFER;
    const extended = {
      left: viewBounds.left - buffer,
      right: viewBounds.right + buffer,
      top: viewBounds.top - buffer,
      bottom: viewBounds.bottom + buffer,
    };

    return resolvedPlacements
      .map((placement) => {
        const tileBounds = {
          left: placement.boardX,
          top: placement.boardY,
          right: placement.boardX + placement.width,
          bottom: placement.boardY + placement.height,
        };

        const intersects =
          tileBounds.right >= extended.left &&
          tileBounds.left <= extended.right &&
          tileBounds.bottom >= extended.top &&
          tileBounds.top <= extended.bottom;

        if (!intersects) {
          return null;
        }

        return placement;
      })
      .filter(Boolean);
  }, [resolvedPlacements, viewBounds, viewportSize.height, viewportSize.width]);

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
          className="artwork-grid"
          aria-live="polite"
          style={{
            width: `${BOARD_WIDTH}px`,
            height: `${BOARD_HEIGHT}px`,
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
          }}
        >
          {visiblePlacements.map((placement) => (
            <ArtworkTile
              key={placement.id}
              artwork={placement.artwork}
              onSelect={onSelect}
              style={{
                width: `${placement.width}px`,
                height: `${placement.height}px`,
                position: 'absolute',
                transform: `translate3d(${placement.boardX}px, ${placement.boardY}px, 0)`,
              }}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

ArtworkGrid.propTypes = {
  placements: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      x: PropTypes.number,
      y: PropTypes.number,
      width: PropTypes.number,
      height: PropTypes.number,
      artwork: PropTypes.shape({
        id: PropTypes.number.isRequired,
        title: PropTypes.string.isRequired,
        artist: PropTypes.string.isRequired,
        thumbnail: PropTypes.string,
        thumbnailWidth: PropTypes.number,
        thumbnailHeight: PropTypes.number,
      }).isRequired,
    })
  ).isRequired,
  onSelect: PropTypes.func.isRequired,
  onViewportChange: PropTypes.func,
};

ArtworkGrid.defaultProps = {
  onViewportChange: null,
};

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { FixedSizeGrid } from 'react-window';

const CELL_SIZE = 260;
const GRID_DIMENSION = 20000;
const GRID_CENTER = Math.floor(GRID_DIMENSION / 2);
const PREFETCH_PADDING = 200;

const toNatural = (value) => (value >= 0 ? value * 2 : -value * 2 - 1);

const cantorPairing = (a, b) => {
  const sum = a + b;
  return ((sum * (sum + 1)) / 2) + b;
};

const coordinateToIndex = (rowIndex, columnIndex) => {
  const row = rowIndex - GRID_CENTER;
  const column = columnIndex - GRID_CENTER;
  const a = toNatural(row);
  const b = toNatural(column);
  return Math.floor(cantorPairing(a, b));
};

const CanvasCell = memo(({ style, columnIndex, rowIndex, artworks, onSelect }) => {
  const index = coordinateToIndex(rowIndex, columnIndex);
  const artwork = artworks[index];
  const hasArtwork = Boolean(artwork);

  return (
    <div style={style} className="canvas__cell">
      {hasArtwork ? (
        <button
          type="button"
          className="canvas__tile"
          onClick={() => onSelect(artwork)}
        >
          <div className="canvas__thumb-wrapper">
            <img
              src={artwork.thumbnail}
              alt={artwork.title}
              loading="lazy"
              className="canvas__thumb"
            />
          </div>
          <div className="canvas__caption">
            <h3>{artwork.title}</h3>
            <p>{artwork.artist}</p>
          </div>
        </button>
      ) : (
        <div className="canvas__placeholder">
          <div className="canvas__pulse" />
        </div>
      )}
    </div>
  );
});

CanvasCell.displayName = 'CanvasCell';

CanvasCell.propTypes = {
  artworks: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number,
    })
  ).isRequired,
  columnIndex: PropTypes.number.isRequired,
  onSelect: PropTypes.func.isRequired,
  rowIndex: PropTypes.number.isRequired,
  style: PropTypes.shape({}).isRequired,
};

export default function ArtworkCanvas({ artworks, ensureIndex, hasMore, loading, onSelect }) {
  const outerRef = useRef(null);
  const viewportRef = useRef(null);
  const lastRequestedRef = useRef(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const hasCenteredRef = useRef(false);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return undefined;
    }

    if (typeof ResizeObserver === 'undefined') {
      const update = () => {
        setDimensions({ width: element.clientWidth, height: element.clientHeight });
      };

      update();
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', update);
      }

      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('resize', update);
        }
      };
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!outerRef.current || hasCenteredRef.current === true) {
      return;
    }
    if (dimensions.width === 0 || dimensions.height === 0) {
      return;
    }

    const outer = outerRef.current;
    const targetScrollLeft = GRID_CENTER * CELL_SIZE - dimensions.width / 2;
    const targetScrollTop = GRID_CENTER * CELL_SIZE - dimensions.height / 2;
    outer.scrollLeft = targetScrollLeft;
    outer.scrollTop = targetScrollTop;
    hasCenteredRef.current = true;
  }, [dimensions.height, dimensions.width]);

  const handleItemsRendered = useCallback(
    ({
      visibleRowStartIndex,
      visibleRowStopIndex,
      visibleColumnStartIndex,
      visibleColumnStopIndex,
    }) => {
      const maxIndex = Math.max(
        coordinateToIndex(visibleRowStartIndex, visibleColumnStartIndex),
        coordinateToIndex(visibleRowStartIndex, visibleColumnStopIndex),
        coordinateToIndex(visibleRowStopIndex, visibleColumnStartIndex),
        coordinateToIndex(visibleRowStopIndex, visibleColumnStopIndex)
      );
      const paddedIndex = maxIndex + PREFETCH_PADDING;

      if (paddedIndex > lastRequestedRef.current && (hasMore || paddedIndex < artworks.length)) {
        lastRequestedRef.current = paddedIndex;
        ensureIndex(paddedIndex);
      }
    },
    [artworks.length, ensureIndex, hasMore]
  );

  useEffect(() => {
    if (!hasMore && artworks.length > 0) {
      lastRequestedRef.current = artworks.length - 1;
    }
  }, [artworks.length, hasMore]);

  const itemData = useMemo(
    () => ({ artworks, onSelect }),
    [artworks, onSelect]
  );

  const CellRenderer = useCallback(
    ({ columnIndex, rowIndex, style, data }) => (
      <CanvasCell
        columnIndex={columnIndex}
        rowIndex={rowIndex}
        style={style}
        artworks={data.artworks}
        onSelect={data.onSelect}
      />
    ),
    []
  );

  const gridWidth = Math.max(dimensions.width, CELL_SIZE * 2);
  const gridHeight = Math.max(dimensions.height, CELL_SIZE * 2);

  return (
    <div className="canvas" role="region" aria-label="Infinite art canvas">
      <div ref={viewportRef} className="canvas__viewport">
        {dimensions.width > 0 && dimensions.height > 0 && (
          <FixedSizeGrid
            className="canvas__grid"
            outerRef={outerRef}
            columnCount={GRID_DIMENSION}
            rowCount={GRID_DIMENSION}
            columnWidth={CELL_SIZE}
            rowHeight={CELL_SIZE}
            height={gridHeight}
            width={gridWidth}
            onItemsRendered={handleItemsRendered}
            overscanColumnCount={4}
            overscanRowCount={4}
            itemData={itemData}
          >
            {CellRenderer}
          </FixedSizeGrid>
        )}
      </div>
      <div className="canvas__overlay">
        <span className="canvas__hint">Scroll to explore{loading ? ' — fetching art…' : ''}</span>
        {!hasMore && !loading && artworks.length > 0 && (
          <span className="canvas__hint canvas__hint--secondary">Every visible tile is now linked to a work from the collection.</span>
        )}
      </div>
    </div>
  );
}

ArtworkCanvas.propTypes = {
  artworks: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number,
    })
  ).isRequired,
  ensureIndex: PropTypes.func.isRequired,
  hasMore: PropTypes.bool.isRequired,
  loading: PropTypes.bool.isRequired,
  onSelect: PropTypes.func.isRequired,
};

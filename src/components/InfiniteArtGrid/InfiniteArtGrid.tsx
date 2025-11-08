import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeGrid, GridChildComponentProps, GridOnItemsRenderedProps } from 'react-window';
import { ArtworkRef, fetchArtworksPage } from '../../lib/aic';
import { useWindowSize } from '../../hooks/useWindowSize';
import {
  FETCH_DEBOUNCE_MS,
  GRID_DIMENSION,
  ORIGIN_INDEX,
  PREFETCH_SECTORS,
  SECTOR_SIZE,
  TILE_SIZE,
} from '../../lib/constants';
import {
  Sector,
  SectorStore,
  tileIndex,
  worldToLocalIndex,
  worldToSectorCoordinate,
} from '../../lib/sectorStore';
import { stableArtworkIndex } from '../../lib/mapping';
import { TileView } from '../Tile/Tile';

interface GridCellContext {
  store: SectorStore;
  artworks: ArtworkRef[];
  iiifBase: string | null;
}

const columnCount = GRID_DIMENSION;
const rowCount = GRID_DIMENSION;

export function InfiniteArtGrid() {
  const { width, height } = useWindowSize();
  const gridRef = useRef<FixedSizeGrid>(null);
  const storeRef = useRef(new SectorStore());
  const requestedPages = useRef(new Set<number>());
  const debounceRef = useRef<number | null>(null);
  const hasScrolledRef = useRef(false);

  const [artworks, setArtworks] = useState<ArtworkRef[]>([]);
  const [iiifBase, setIiifBase] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [nextPage, setNextPage] = useState<number | null>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const populateSector = useCallback(
    (sector: Sector, artworkCount: number) => {
      if (artworkCount <= 0) {
        return;
      }

      const baseCol = sector.sx * SECTOR_SIZE;
      const baseRow = sector.sy * SECTOR_SIZE;

      for (let localRow = 0; localRow < SECTOR_SIZE; localRow += 1) {
        for (let localCol = 0; localCol < SECTOR_SIZE; localCol += 1) {
          const index = tileIndex(localCol, localRow);
          const tile = sector.tiles[index];
          if (tile.state === 'ready' && tile.artworkIndex !== undefined) {
            continue;
          }

          const worldCol = baseCol + localCol;
          const worldRow = baseRow + localRow;
          const artworkIndex = stableArtworkIndex(worldCol, worldRow, artworkCount);

          if (artworkIndex >= 0) {
            tile.artworkIndex = artworkIndex;
            tile.state = 'ready';
          } else {
            tile.artworkIndex = undefined;
            tile.state = 'empty';
          }
        }
      }
    },
    []
  );

  const loadPage = useCallback(async (page: number) => {
    if (requestedPages.current.has(page)) {
      return;
    }

    requestedPages.current.add(page);
    setLoading(true);
    setError(null);

    try {
      const result = await fetchArtworksPage(page);
      if (result.iiifBase) {
        setIiifBase((current) => current ?? result.iiifBase);
      }

      setArtworks((prev) => {
        if (result.artworks.length === 0) {
          return prev;
        }
        const existing = new Set(prev.map((item) => item.id));
        const merged = result.artworks.filter((item) => !existing.has(item.id));
        return merged.length > 0 ? [...prev, ...merged] : prev;
      });

      setHasMore(result.hasMore);
      setNextPage(result.nextPage);
    } catch (err) {
      requestedPages.current.delete(page);
      setError((err as Error).message ?? 'Failed to load artworks');
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleNextPage = useCallback(() => {
    if (!hasMore || nextPage == null || loading) {
      return;
    }

    if (requestedPages.current.has(nextPage)) {
      return;
    }

    if (debounceRef.current !== null) {
      return;
    }

    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      loadPage(nextPage).catch((err) => {
        console.error(err);
      });
    }, FETCH_DEBOUNCE_MS);
  }, [hasMore, nextPage, loadPage, loading]);

  useEffect(() => {
    loadPage(1).catch((err) => {
      console.error(err);
    });
  }, [loadPage]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!gridRef.current || hasScrolledRef.current) {
      return;
    }
    if (width === 0 || height === 0) {
      return;
    }
    hasScrolledRef.current = true;
    gridRef.current.scrollToItem({ columnIndex: ORIGIN_INDEX, rowIndex: ORIGIN_INDEX, align: 'center' });
  }, [width, height]);

  useEffect(() => {
    if (artworks.length === 0) {
      return;
    }

    for (const sector of storeRef.current.values()) {
      populateSector(sector, artworks.length);
    }
  }, [artworks.length, populateSector]);

  const handleItemsRendered = useCallback(
    ({
      visibleColumnStart,
      visibleColumnStop,
      visibleRowStart,
      visibleRowStop,
    }: GridOnItemsRenderedProps) => {
      const store = storeRef.current;
      const artworkCount = artworks.length;

      const worldColStart = visibleColumnStart - ORIGIN_INDEX;
      const worldColEnd = visibleColumnStop - ORIGIN_INDEX;
      const worldRowStart = visibleRowStart - ORIGIN_INDEX;
      const worldRowEnd = visibleRowStop - ORIGIN_INDEX;

      const paddedColStart = worldColStart - PREFETCH_SECTORS * SECTOR_SIZE;
      const paddedColEnd = worldColEnd + PREFETCH_SECTORS * SECTOR_SIZE;
      const paddedRowStart = worldRowStart - PREFETCH_SECTORS * SECTOR_SIZE;
      const paddedRowEnd = worldRowEnd + PREFETCH_SECTORS * SECTOR_SIZE;

      const sectorStartX = worldToSectorCoordinate(paddedColStart);
      const sectorEndX = worldToSectorCoordinate(paddedColEnd);
      const sectorStartY = worldToSectorCoordinate(paddedRowStart);
      const sectorEndY = worldToSectorCoordinate(paddedRowEnd);

      for (let sy = sectorStartY; sy <= sectorEndY; sy += 1) {
        for (let sx = sectorStartX; sx <= sectorEndX; sx += 1) {
          const { sector, isNew } = store.getOrCreate(sx, sy);
          if (artworkCount > 0 && (isNew || sector.tiles.some((tile) => tile.state === 'empty'))) {
            populateSector(sector, artworkCount);
          }
        }
      }

      store.evictIfNeeded();

      const bounds = store.getBounds();
      if (bounds) {
        const visibleSectorStartX = worldToSectorCoordinate(worldColStart);
        const visibleSectorEndX = worldToSectorCoordinate(worldColEnd);
        const visibleSectorStartY = worldToSectorCoordinate(worldRowStart);
        const visibleSectorEndY = worldToSectorCoordinate(worldRowEnd);

        const nearLeft = visibleSectorStartX <= bounds.minSx + 1;
        const nearRight = visibleSectorEndX >= bounds.maxSx - 1;
        const nearTop = visibleSectorStartY <= bounds.minSy + 1;
        const nearBottom = visibleSectorEndY >= bounds.maxSy - 1;

        if ((nearLeft || nearRight || nearTop || nearBottom) && hasMore) {
          scheduleNextPage();
        }
      }
    },
    [artworks.length, hasMore, populateSector, scheduleNextPage]
  );

  const cellContext = useMemo<GridCellContext>(
    () => ({
      store: storeRef.current,
      artworks,
      iiifBase,
    }),
    [artworks, iiifBase]
  );

  const Cell = useCallback(
    ({ columnIndex, rowIndex, style, data }: GridChildComponentProps<GridCellContext>) => {
      const worldCol = columnIndex - ORIGIN_INDEX;
      const worldRow = rowIndex - ORIGIN_INDEX;
      const sx = worldToSectorCoordinate(worldCol);
      const sy = worldToSectorCoordinate(worldRow);

      const { store, artworks: artworksList, iiifBase: base } = data;
      const { sector } = store.getOrCreate(sx, sy);
      const localCol = worldToLocalIndex(worldCol);
      const localRow = worldToLocalIndex(worldRow);
      const idx = tileIndex(localCol, localRow);
      const tile = sector.tiles[idx];

      if (artworksList.length > 0 && (tile.state === 'empty' || tile.artworkIndex === undefined)) {
        const artworkIndex = stableArtworkIndex(worldCol, worldRow, artworksList.length);
        if (artworkIndex >= 0) {
          tile.artworkIndex = artworkIndex;
          tile.state = 'ready';
        }
      }

      const artwork =
        tile.artworkIndex !== undefined && tile.artworkIndex < artworksList.length
          ? artworksList[tile.artworkIndex]
          : undefined;

      return (
        <div style={style} className="tile-positioner">
          <TileView artwork={artwork} iiifBase={base} size={TILE_SIZE} />
        </div>
      );
    },
    []
  );

  return (
    <div className="art-grid-container">
      {loading && <div className="fetch-indicator">Fetching</div>}
      {error && !loading && <div className="fetch-indicator">{error}</div>}
      <FixedSizeGrid
        ref={gridRef}
        className="art-grid"
        columnCount={columnCount}
        columnWidth={TILE_SIZE}
        height={height}
        rowCount={rowCount}
        rowHeight={TILE_SIZE}
        width={width}
        onItemsRendered={handleItemsRendered}
        itemData={cellContext}
      >
        {Cell}
      </FixedSizeGrid>
    </div>
  );
}

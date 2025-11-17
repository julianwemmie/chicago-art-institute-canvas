import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DataFn,
  GridItem,
  Viewport,
} from '../components/pannableTypes';

type Options = {
  items?: GridItem[];
  getItems?: DataFn;
  view: Viewport;
  expandedView: Viewport;
  hasViewport: boolean;
};

export const useGridItems = ({
  items,
  getItems,
  view,
  expandedView,
  hasViewport,
}: Options) => {
  const [dynamicItems, setDynamicItems] = useState<GridItem[]>([]);
  const getItemsRef = useRef(getItems);
  const prevViewRef = useRef<Viewport | null>(null);
  const requestIdRef = useRef(0);
  const useDataFn = Boolean(getItems);

  useEffect(() => {
    getItemsRef.current = getItems;
  }, [getItems]);

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
  }, [expandedView, getItems, hasViewport, view]);

  const currentItems = useMemo(
    () => (useDataFn ? dynamicItems : items ?? []),
    [useDataFn, dynamicItems, items],
  );

  const renderableItems = useMemo(() => {
    if (!currentItems.length) return [];
    const xMin = expandedView.x;
    const xMax = expandedView.x + expandedView.width;
    const yMin = expandedView.y;
    const yMax = expandedView.y + expandedView.height;
    return currentItems.filter(
      (item) =>
        item.x >= xMin && item.x <= xMax && item.y >= yMin && item.y <= yMax,
    );
  }, [currentItems, expandedView]);

  return { currentItems, renderableItems };
};

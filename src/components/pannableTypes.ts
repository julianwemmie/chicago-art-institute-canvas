import type { ReactNode } from 'react';

export type Camera = { x: number; y: number };

export type GridItem = {
  id?: string | number;
  x: number;
  y: number;
  content: ReactNode;
};

export type Viewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DataFn = (
  view: Viewport,
  prevView: Viewport,
) => GridItem[] | Promise<GridItem[]>;

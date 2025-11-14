import { useCallback, useMemo } from "react";
import { PannableGrid, Viewport } from "./components/PannableGrid";
import { MasonryLayout } from "./lib/masonry";
import { createAICImageGenerator } from "./api/aic";

export default function App(): JSX.Element {
  const generator = useMemo(createAICImageGenerator, []);
  const layout = useMemo(
    () =>
      new MasonryLayout({
        columnWidth: 450,
        columnGap: 16,
        rowGap: 16,
        originX: -600,
        originY: -600,
        generator,
      }),
    [generator],
  );

  const getItems = useCallback(
    (view: Viewport, _prevView?: Viewport) => layout.getItems(view),
    [layout],
  );

  return (
    <div className="app">
      <PannableGrid getItems={getItems} overscan={1000} debug />
    </div>
  );
}

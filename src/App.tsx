import { useCallback, useEffect, useMemo, useState } from "react";
import { PannableGrid, Viewport } from "./components/PannableGrid";
import { MasonryLayout } from "./lib/masonry";
import { ActiveCardProvider, createAICImageGenerator } from "./components/AICImageCard";

const DEFAULT_IMAGE_WIDTH = 450;

export default function App(): JSX.Element {

  let imageWidth = DEFAULT_IMAGE_WIDTH;
  const vwPixels = window.visualViewport?.width;
  if (vwPixels && vwPixels < DEFAULT_IMAGE_WIDTH) {
    imageWidth = vwPixels - 50;
  }

  const generator = useMemo(
    () =>
      createAICImageGenerator(
        {
          imageWidth: imageWidth,
        },
        {
          columnWidth: imageWidth,
        },
      ),
    [imageWidth],
  );
  const layout = useMemo(
    () =>
      new MasonryLayout({
        columnWidth: imageWidth,
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
    <ActiveCardProvider>
      <div className="app">
        <PannableGrid
          getItems={getItems}
          overscan={1000}
          minZoomPercent={60}
          maxZoomPercent={175}
          // debug
        />
      </div>
    </ActiveCardProvider>
  );
}

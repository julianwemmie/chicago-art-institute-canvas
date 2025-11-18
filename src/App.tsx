import { useCallback, useMemo, useState } from "react";
import { PannableGrid, Viewport } from "./components/PannableGrid";
import { MasonryLayout } from "./lib/masonry";
import { ActiveCardProvider, createAICImageGenerator } from "./components/AICImageCard";

const DEFAULT_IMAGE_WIDTH = 450;

export default function App(): JSX.Element {

  const [showWelcome, setShowWelcome] = useState<boolean>(true);
  let imageWidth = DEFAULT_IMAGE_WIDTH;
  const vwPixels = window.visualViewport?.width;
  if (vwPixels && vwPixels < DEFAULT_IMAGE_WIDTH) {
    imageWidth = vwPixels - 50;
  }

  const [pendingImages, setPendingImages] = useState(0);

  const handleImageLoadStart = useCallback(() => {
    setPendingImages((count) => count + 1);
  }, []);

  const handleImageLoadEnd = useCallback(() => {
    setPendingImages((count) => (count > 0 ? count - 1 : 0));
  }, []);

  const generator = useMemo(
    () =>
      createAICImageGenerator(
        {
          imageWidth: imageWidth
        },
        {
          columnWidth: imageWidth,
          onImageLoadStart: handleImageLoadStart,
          onImageLoadEnd: handleImageLoadEnd,
        },
      ),
    [handleImageLoadEnd, handleImageLoadStart, imageWidth],
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

  const handleCloseWelcome = useCallback(() => {
    setShowWelcome(false);
  }, []);

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
        {pendingImages > 4 && (
          <div className="loading-indicator" role="status" aria-live="polite">
            <span className="loading-indicator__label">Loading</span>
            <span className="loading-indicator__spinner" aria-hidden="true" />
          </div>
        )}
        {showWelcome && (
          <div className="welcome-modal__backdrop" role="presentation">
            <div className="welcome-modal" role="dialog" aria-modal="true" aria-label="Welcome">
              <button
                type="button"
                className="welcome-modal__close"
                onClick={handleCloseWelcome}
                aria-label="Close welcome"
              >
                ×
              </button>
              <p className="welcome-modal__eyebrow">Welcome to</p>
              <h1 className="welcome-modal__title">Institutum Infinitum</h1>
              <p className="welcome-modal__body">
                Explore the Chicago Institute of Art&apos;s collection of over 150,000 artworks,
                artifacts, and photographs.
              </p>
              <ul className="welcome-modal__list">
                <li>Pan in any direction to discover new items.</li>
                <li>Click on an image to favorite or view more details.</li>
              </ul>
              <div className="welcome-modal__actions">
                <button type="button" className="welcome-modal__cta" onClick={handleCloseWelcome}>
                  <span>Explore</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ActiveCardProvider>
  );
}

import {
  KeyboardEvent,
  MouseEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
} from "react";
import { useGridMetrics } from "./PannableGrid";
import { ArtworkImage, GeneratorOptions, createAICImageDataGenerator } from "../api/aic";
import { MasonryImage } from "../lib/masonry";

export type RenderOptions = {
  columnWidth?: number;
  onFavorite?: (image: ArtworkImage) => void;
  onDetails?: (image: ArtworkImage) => void;
  onImageLoadStart?: () => void;
  onImageLoadEnd?: () => void;
};

export function createAICImageGenerator(
  options: GeneratorOptions = {},
  renderOptions: RenderOptions = {},
): () => Promise<MasonryImage> {
  const dataGenerator = createAICImageDataGenerator(options);
  const columnWidth = renderOptions.columnWidth ?? options.imageWidth;

  return async () => {
    const image = await dataGenerator();
    return buildMasonryImageFromData(image, { ...renderOptions, columnWidth });
  };
}

export function buildMasonryImageFromData(
  image: ArtworkImage,
  renderOptions: RenderOptions,
): MasonryImage {
  const columnWidth = renderOptions.columnWidth ?? image.width;
  return {
    id: image.id,
    width: image.width,
    height: image.height,
    content: (
      <AICImageCard
        image={image}
        columnWidth={columnWidth}
        onFavorite={renderOptions.onFavorite}
        onDetails={renderOptions.onDetails}
        onImageLoadStart={renderOptions.onImageLoadStart}
        onImageLoadEnd={renderOptions.onImageLoadEnd}
      />
    ),
  };
}

type ImageCardProps = RenderOptions & {
  image: ArtworkImage;
  columnWidth?: number;
};

type ActiveCardContextValue = {
  activeId: number | null;
  setActiveId: (id: number | null) => void;
};

const ActiveCardContext = createContext<ActiveCardContextValue | undefined>(undefined);

export function ActiveCardProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const value = useMemo(() => ({ activeId, setActiveId }), [activeId]);
  return <ActiveCardContext.Provider value={value}>{children}</ActiveCardContext.Provider>;
}

function useActiveCard(): ActiveCardContextValue {
  const ctx = useContext(ActiveCardContext);
  if (!ctx) {
    throw new Error("useActiveCard must be used within ActiveCardProvider");
  }
  return ctx;
}

function AICImageCard({
  image,
  columnWidth,
  onFavorite,
  onDetails,
  onImageLoadStart,
  onImageLoadEnd,
}: ImageCardProps): JSX.Element {
  const { activeId, setActiveId } = useActiveCard();
  const isActive = activeId === image.id;
  const imgRef = useRef<HTMLImageElement | null>(null);
  const { zoom, viewportWidth } = useGridMetrics();
  const [useHighRes, setUseHighRes] = useState(false);
  const displaySrc = useHighRes ? image.largeImageUrl : image.imageUrl;

  const updateResolutionPreference = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const viewportPixels =
      viewportWidth ||
      window.visualViewport?.width ||
      window.innerWidth ||
      0;
    if (viewportPixels === 0) return;
    const renderedWidth = img.getBoundingClientRect?.().width ?? 0;
    if (renderedWidth === 0) return;
    setUseHighRes(renderedWidth / viewportPixels >= 0.6);
  }, [viewportWidth]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    let started = false;
    let finished = false;

    const start = () => {
      if (started) return;
      started = true;
      onImageLoadStart?.();
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      onImageLoadEnd?.();
    };

    // If the image is already cached, skip the loading state.
    if (img.complete && img.naturalWidth > 0) {
      finish();
      return;
    }

    start();

    const handleLoad = () => {
      finish();
    };
    const handleError = () => {
      finish();
    };

    img.addEventListener("load", handleLoad);
    img.addEventListener("error", handleError);

    return () => {
      img.removeEventListener("load", handleLoad);
      img.removeEventListener("error", handleError);
      // If unmounted mid-load, make sure we clear the pending count.
      if (started && !finished) {
        finish();
      }
    };
  }, [displaySrc, onImageLoadEnd, onImageLoadStart]);

  useEffect(() => {
    updateResolutionPreference();
  }, [zoom, updateResolutionPreference]);

  useEffect(() => {
    const img = imgRef.current;
    const observer =
      typeof ResizeObserver !== "undefined" && img
        ? new ResizeObserver(() => {
            updateResolutionPreference();
          })
        : null;

    if (observer && img) {
      observer.observe(img);
    }
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", updateResolutionPreference);
    visualViewport?.addEventListener("scroll", updateResolutionPreference);
    window.addEventListener("resize", updateResolutionPreference);

    return () => {
      observer?.disconnect();
      visualViewport?.removeEventListener("resize", updateResolutionPreference);
      visualViewport?.removeEventListener("scroll", updateResolutionPreference);
      window.removeEventListener("resize", updateResolutionPreference);
    };
  }, [updateResolutionPreference]);

  const toggleOverlay = () => setActiveId(isActive ? null : image.id);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleOverlay();
    }
  };

  const handleFavorite = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onFavorite?.(image);
  };

  const detailsUrl = image.infoUrl || image.largeImageUrl || image.imageUrl;

  return (
    <div
      className="aic-image-card"
      style={columnWidth ? { width: columnWidth } : undefined}
      data-allow-click="true"
    >
      <div
        className="aic-image-card__frame"
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          toggleOverlay();
        }}
        onKeyDown={handleKeyDown}
        aria-pressed={isActive}
      >
        <img
          ref={imgRef}
          src={displaySrc}
          alt={image.title ?? "Artwork"}
          loading="eager"
          style={{ display: "block", width: "100%", height: "auto", pointerEvents: "none" }}
        />
        <div className={`aic-image-card__overlay${isActive ? " is-visible" : ""}`}>
          <div className="aic-image-card__actions">
            {/* <button
              type="button"
              className="aic-image-card__action"
              onClick={handleFavorite}
            >
              <HeartIcon />
              <span>Favorite</span>
            </button> */}
            <a
              className="aic-image-card__action"
              href={detailsUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                event.stopPropagation();
                onDetails?.(image);
              }}
            >
              <InfoIcon />
              <span>Details</span>
              <ExternalIcon />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeartIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 -2 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.8 4.6c-1.7-1.7-4.4-1.7-6.1 0l-.7.7-.7-.7C11.6 3 9 3 7.3 4.6 5.6 6.3 5.6 9 7.3 10.7l.7.7 6 6 6-6 .7-.7c1.7-1.7 1.7-4.4 0-6.1Z" />
    </svg>
  );
}

function InfoIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width="35"
      height="35"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="8.01" />
      <line x1="12" y1="12" x2="12" y2="16" />
    </svg>
  );
}

function ExternalIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width="30"
      height="30  "
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

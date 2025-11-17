import { KeyboardEvent, MouseEvent, useContext, useMemo, useState, createContext } from "react";
import { ArtworkImage, GeneratorOptions, createAICImageDataGenerator } from "../api/aic";
import { MasonryImage } from "../lib/masonry";

export type RenderOptions = {
  columnWidth?: number;
  onFavorite?: (image: ArtworkImage) => void;
  onDetails?: (image: ArtworkImage) => void;
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
}: ImageCardProps): JSX.Element {
  const { activeId, setActiveId } = useActiveCard();
  const isActive = activeId === image.id;

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

  const handleDetails = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDetails?.(image);
  };

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
          src={image.imageUrl}
          alt={image.title ?? "Artwork"}
          loading="eager"
          style={{ display: "block", width: "100%", height: "auto", pointerEvents: "none" }}
        />
        <div className={`aic-image-card__overlay${isActive ? " is-visible" : ""}`}>
          <div className="aic-image-card__actions">
            <button
              type="button"
              className="aic-image-card__action"
              onClick={handleFavorite}
            >
              <HeartIcon />
              <span>Favorite</span>
            </button>
            <button
              type="button"
              className="aic-image-card__action"
              onClick={handleDetails}
            >
              <InfoIcon />
              <span>Details</span>
              <ExternalIcon />
            </button>
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
      width="18"
      height="18"
      viewBox="0 0 24 24"
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
      width="18"
      height="18"
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
      width="16"
      height="16"
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

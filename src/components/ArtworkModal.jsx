import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

export default function ArtworkModal({ artwork, onClose }) {
  const [isImageLoaded, setImageLoaded] = useState(false);
  const [preloadedSrc, setPreloadedSrc] = useState(null);

  useEffect(() => {
    if (!artwork) {
      return undefined;
    }

    // reset states for the new artwork
    setImageLoaded(false);
    setPreloadedSrc(null);

    // Preload the high-res image off-DOM to avoid flicker / blank paint
    const img = new Image();
    // prefer async decoding if supported
    try {
      img.decoding = 'async';
    } catch (e) {
      // ignore if not supported
    }
    img.src = artwork.large;
    img.onload = () => {
      // only set the preloaded src after the image is fully decoded/loaded
      setPreloadedSrc(artwork.large);
      setImageLoaded(true);
    };
    img.onerror = () => {
      // treat errors as loaded so the UI can fall back / hide the preview
      setPreloadedSrc(null);
      setImageLoaded(true);
    };

    const onKeyUp = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keyup', onKeyUp);
      // Cleanup image loading handlers to avoid leaks
      img.onload = null;
      img.onerror = null;
      try {
        img.src = '';
      } catch (e) {
        // noop
      }
    };
  }, [artwork, onClose]);

  if (!artwork) {
    return null;
  }

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal__content" role="document">
        <button type="button" className="modal__close" onClick={onClose}>
          ×
        </button>
        <figure className="modal__body">
          <div
            className={`modal__media${isImageLoaded ? ' modal__media--loaded' : ''}`}
          >
            {/* Preview thumbnail stays in the flow to reserve layout and sits beneath the full image. */}
            <img
              className={`modal__image modal__image--preview${isImageLoaded ? ' modal__image--preview-hidden' : ' modal__image--visible'}`}
              src={artwork.thumbnail}
              alt=""
              aria-hidden="true"
              width={artwork?.thumbnailWidth || undefined}
              height={artwork?.thumbnailHeight || undefined}
            />

            {/* Render the full image only after it's been preloaded to avoid flicker. */}
            {preloadedSrc && (
              <img
                className={`modal__image modal__image--full${isImageLoaded ? ' modal__image--visible' : ''}`}
                src={preloadedSrc}
                alt={artwork.title}
                width={artwork?.thumbnailWidth || undefined}
                height={artwork?.thumbnailHeight || undefined}
                // onLoad is redundant due to preloading, but keep for safety
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageLoaded(true)}
              />
            )}
          </div>
          <figcaption className="modal__details">
            <h2>{artwork.title}</h2>
            <p>{artwork.artist}</p>
            <p>{artwork.date}</p>
            <p>{artwork.medium}</p>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

ArtworkModal.propTypes = {
  artwork: PropTypes.shape({
    title: PropTypes.string,
    artist: PropTypes.string,
    date: PropTypes.string,
    medium: PropTypes.string,
    thumbnail: PropTypes.string,
    thumbnailWidth: PropTypes.number,
    thumbnailHeight: PropTypes.number,
    large: PropTypes.string,
  }),
  onClose: PropTypes.func.isRequired,
};

ArtworkModal.defaultProps = {
  artwork: null,
};

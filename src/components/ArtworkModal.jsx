import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

const hasValidDimensions = (width, height) =>
  Number.isFinite(width) &&
  Number.isFinite(height) &&
  width > 0 &&
  height > 0;

export default function ArtworkModal({ artwork, onClose }) {
  const [isHighResReady, setHighResReady] = useState(false);

  const mediaAspectRatio =
    artwork &&
    hasValidDimensions(artwork.thumbnailWidth, artwork.thumbnailHeight)
      ? `${artwork.thumbnailWidth} / ${artwork.thumbnailHeight}`
      : null;

  useEffect(() => {
    if (!artwork) {
      return undefined;
    }

    setHighResReady(false);

    const onKeyUp = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keyup', onKeyUp);
    return () => document.removeEventListener('keyup', onKeyUp);
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
            className="modal__media"
            style={mediaAspectRatio ? { aspectRatio: mediaAspectRatio } : undefined}
          >
            {artwork.thumbnail && (
              <img
                className={`modal__image modal__image--preview${
                  isHighResReady ? ' modal__image--preview-hidden' : ''
                }`}
                src={artwork.thumbnail}
                alt=""
                role="presentation"
                aria-hidden="true"
              />
            )}
            {artwork.large && (
              <img
                className={`modal__image modal__image--full${
                  isHighResReady ? ' modal__image--visible' : ''
                }`}
                src={artwork.large}
                alt={artwork.title}
                onLoad={() => setHighResReady(true)}
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

import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

export default function ArtworkModal({ artwork, onClose }) {
  const [isImageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    if (!artwork) {
      return undefined;
    }

    setImageLoaded(false);

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
            className={`modal__media${isImageLoaded ? ' modal__media--loaded' : ''}`}
          >
            <img
              className={`modal__image modal__image--preview${isImageLoaded ? ' modal__image--preview-hidden' : ' modal__image--visible'}`}
              src={artwork.thumbnail}
              alt=""
              aria-hidden="true"
            />
            <img
              className={`modal__image modal__image--full${isImageLoaded ? ' modal__image--visible' : ''}`}
              src={artwork.large}
              alt={artwork.title}
              width={artwork?.thumbnailWidth || undefined}
              height={artwork?.thumbnailHeight || undefined}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageLoaded(true)}
            />
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

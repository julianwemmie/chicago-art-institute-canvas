import { useEffect } from 'react';
import PropTypes from 'prop-types';

export default function ArtworkModal({ artwork, onClose }) {
  useEffect(() => {
    if (!artwork) {
      return undefined;
    }

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
        <figure>
          <img src={artwork.large} alt={artwork.title} />
          <figcaption>
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
    large: PropTypes.string,
  }),
  onClose: PropTypes.func.isRequired,
};

ArtworkModal.defaultProps = {
  artwork: null,
};

import PropTypes from 'prop-types';

function ArtworkTile({ artwork, onSelect }) {
  const { thumbnailWidth, thumbnailHeight } = artwork;
  const aspectRatio =
    typeof thumbnailWidth === 'number' && typeof thumbnailHeight === 'number' && thumbnailWidth > 0 && thumbnailHeight > 0
      ? `${thumbnailWidth} / ${thumbnailHeight}`
      : undefined;

  return (
    <button
      type="button"
      className="artwork-tile"
      style={aspectRatio ? { aspectRatio } : undefined}
      onClick={() => onSelect(artwork)}
    >
      <img
        src={artwork.thumbnail}
        alt={artwork.title}
        loading="lazy"
      />
      <div className="artwork-tile__overlay">
        <h3>{artwork.title}</h3>
        <p>{artwork.artist}</p>
      </div>
    </button>
  );
}

ArtworkTile.propTypes = {
  artwork: PropTypes.shape({
    id: PropTypes.number.isRequired,
    title: PropTypes.string.isRequired,
    artist: PropTypes.string.isRequired,
    thumbnail: PropTypes.string,
    thumbnailWidth: PropTypes.number,
    thumbnailHeight: PropTypes.number,
  }).isRequired,
  onSelect: PropTypes.func.isRequired,
};

export default function ArtworkGrid({ artworks, onSelect }) {
  return (
    <section className="artwork-grid" aria-live="polite">
      {artworks.map((artwork) => (
        <ArtworkTile
          key={artwork.id}
          artwork={artwork}
          onSelect={onSelect}
        />
      ))}
    </section>
  );
}

ArtworkGrid.propTypes = {
  artworks: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
    })
  ).isRequired,
  onSelect: PropTypes.func.isRequired,
};

import { useEffect, useMemo, useState } from 'react';
import { ArtworkRef, buildIiifImageUrl } from '../../lib/aic';
import { IIIF_IMAGE_SIZE } from '../../lib/constants';

interface TileProps {
  artwork?: ArtworkRef;
  iiifBase?: string | null;
  size: number;
}

export function TileView({ artwork, iiifBase, size }: TileProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [artwork?.id, iiifBase]);

  const altText = useMemo(() => {
    if (!artwork) {
      return 'Artwork placeholder';
    }
    const title = artwork.title?.trim() || 'Artwork';
    const artist = artwork.artist?.trim();
    return artist ? `${title} — ${artist}` : title;
  }, [artwork]);

  const imageUrl = useMemo(() => {
    if (!artwork || !iiifBase || hasError) {
      return null;
    }
    return buildIiifImageUrl(iiifBase, artwork.imageId, IIIF_IMAGE_SIZE);
  }, [artwork, iiifBase, hasError]);

  const showImage = Boolean(imageUrl);

  return (
    <div className="tile-shell" style={{ width: size, height: size }}>
      <div className={`tile${hasError ? ' tile-error' : ''}`}>
        {showImage ? (
          <img
            src={imageUrl ?? ''}
            alt={altText}
            loading="lazy"
            onError={() => setHasError(true)}
          />
        ) : (
          <div className="tile-placeholder" aria-label={altText}>
            Loading
          </div>
        )}
      </div>
    </div>
  );
}

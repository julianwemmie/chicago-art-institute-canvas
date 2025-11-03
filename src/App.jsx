import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ArtworkGrid from './components/ArtworkGrid.jsx';
import ArtworkModal from './components/ArtworkModal.jsx';

const PAGE_SIZE = 30;
const API_URL = 'https://api.artic.edu/api/v1/artworks';
const FIELDS = ['id', 'title', 'image_id', 'artist_display', 'date_display', 'thumbnail', 'medium_display'];

const buildImageUrl = (imageId, size = 400) =>
  imageId ? `https://www.artic.edu/iiif/2/${imageId}/full/${size},/0/default.jpg` : null;

export default function App() {
  const [artworks, setArtworks] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const observerTarget = useRef(null);

  const fetchArtworks = useCallback(async () => {
    if (loading || !hasMore) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = new URL(API_URL);
      url.searchParams.set('page', page);
      url.searchParams.set('limit', PAGE_SIZE);
      url.searchParams.set('fields', FIELDS.join(','));

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const data = await response.json();
      const nextArtworks = data.data
        .filter((item) => item.image_id)
        .map((item) => {
          const thumbnailWidth = item.thumbnail?.width ?? null;
          const thumbnailHeight = item.thumbnail?.height ?? null;

          return {
            id: item.id,
            title: item.title,
            artist: item.artist_display || 'Unknown Artist',
            date: item.date_display || 'Date unknown',
            medium: item.medium_display || 'Medium unknown',
            imageId: item.image_id,
            thumbnail: buildImageUrl(item.image_id, 400),
            large: buildImageUrl(item.image_id, 800),
            thumbnailWidth,
            thumbnailHeight,
          };
        });

      setArtworks((prev) => {
        const existingIds = new Set(prev.map((item) => item.id));
        const uniqueNextArtworks = [];

        for (const artwork of nextArtworks) {
          if (!existingIds.has(artwork.id)) {
            existingIds.add(artwork.id);
            uniqueNextArtworks.push(artwork);
          }
        }

        if (uniqueNextArtworks.length === 0) {
          return prev;
        }

        return [...prev, ...uniqueNextArtworks];
      });
      setHasMore(Boolean(data.pagination?.next_url));
      setPage((prev) => prev + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, loading, hasMore]);

  useEffect(() => {
    fetchArtworks();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          fetchArtworks();
        }
      },
      {
        rootMargin: '200px',
      }
    );

    const target = observerTarget.current;
    if (target) {
      observer.observe(target);
    }

    return () => {
      if (target) {
        observer.unobserve(target);
      }
      observer.disconnect();
    };
  }, [fetchArtworks]);

  const content = useMemo(() => {
    if (error) {
      return (
        <div className="status status--error">
          <p>There was a problem loading artwork. Please try again.</p>
          <p className="status__details">{error}</p>
        </div>
      );
    }

    if (!loading && artworks.length === 0) {
      return (
        <div className="status">
          <p>No artwork found right now. Please try again later.</p>
        </div>
      );
    }

    return (
      <ArtworkGrid
        artworks={artworks}
        onSelect={(artwork) => setSelected(artwork)}
      />
    );
  }, [artworks, error, loading]);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Art Institute Explorer</h1>
        <p>Scroll through an endless wall of art and tap a tile for details.</p>
      </header>

      {content}

      <div ref={observerTarget} className="sentinel" aria-hidden="true" />

      {loading && (
        <div className="status">
          <p>Loading more artwork…</p>
        </div>
      )}

      <ArtworkModal
        artwork={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

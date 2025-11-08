import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ArtworkCanvas from './components/ArtworkCanvas.jsx';
import ArtworkModal from './components/ArtworkModal.jsx';

const PAGE_SIZE = 60;
const API_URL = 'https://api.artic.edu/api/v1/artworks';
const FIELDS = ['id', 'title', 'image_id', 'artist_display', 'date_display', 'thumbnail', 'medium_display'];

const buildImageUrl = (imageId, size = 400) =>
  imageId ? `https://www.artic.edu/iiif/2/${imageId}/full/${size},/0/default.jpg` : null;

export default function App() {
  const [artworks, setArtworks] = useState([]);
  const [requestedIndex, setRequestedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [selected, setSelected] = useState(null);

  const pageRef = useRef(1);
  const totalRef = useRef(null);
  const loadingPageRef = useRef(false);
  const seenIds = useRef(new Set());

  const fetchNextPage = useCallback(async () => {
    if (loadingPageRef.current || !hasMore) {
      return;
    }

    loadingPageRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const url = new URL(API_URL);
      url.searchParams.set('page', pageRef.current.toString());
      url.searchParams.set('limit', PAGE_SIZE.toString());
      url.searchParams.set('fields', FIELDS.join(','));

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const payload = await response.json();
      const items = (payload.data || [])
        .filter((item) => item.image_id)
        .map((item) => ({
          id: item.id,
          title: item.title,
          artist: item.artist_display || 'Unknown Artist',
          date: item.date_display || 'Date unknown',
          medium: item.medium_display || 'Medium unknown',
          imageId: item.image_id,
          thumbnail: buildImageUrl(item.image_id, 400),
          large: buildImageUrl(item.image_id, 900),
          thumbnailWidth: item.thumbnail?.width ?? null,
          thumbnailHeight: item.thumbnail?.height ?? null,
        }))
        .filter((item) => {
          if (seenIds.current.has(item.id)) {
            return false;
          }
          seenIds.current.add(item.id);
          return true;
        });

      if (payload.pagination?.total && !totalRef.current) {
        totalRef.current = payload.pagination.total;
      }

      if (items.length > 0) {
        setArtworks((prev) => [...prev, ...items]);
      }

      pageRef.current += 1;
      if (!payload.pagination?.next_url || (totalRef.current && artworks.length + items.length >= totalRef.current)) {
        setHasMore(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      loadingPageRef.current = false;
      setLoading(false);
    }
  }, [artworks.length, hasMore]);

  const ensureIndex = useCallback(
    (index) => {
      setRequestedIndex((prev) => (index > prev ? index : prev));
    },
    []
  );

  useEffect(() => {
    if (!hasMore && artworks.length === 0) {
      return;
    }

    if (artworks.length > requestedIndex || !hasMore) {
      return;
    }

    if (!loadingPageRef.current) {
      void fetchNextPage();
    }
  }, [requestedIndex, artworks.length, fetchNextPage, hasMore]);

  useEffect(() => {
    ensureIndex(0);
  }, [ensureIndex]);

  const statusMessage = useMemo(() => {
    if (error) {
      return 'There was a problem loading artwork. Try panning again in a moment.';
    }
    if (!hasMore && artworks.length === 0) {
      return 'No artwork available right now.';
    }
    return null;
  }, [artworks.length, error, hasMore]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Chicago Art Atlas</h1>
          <p>Drag or scroll in any direction to roam an endless canvas of the Art Institute of Chicago collection.</p>
        </div>
        <div className="app__badges" role="status" aria-live="polite">
          {loading && <span className="app__badge app__badge--pulse">Loading</span>}
          {!loading && (
            <span className="app__badge">
              {artworks.length > 0
                ? `Loaded ${artworks.length.toLocaleString()} works`
                : 'Awaiting artwork'}
            </span>
          )}
        </div>
      </header>

      <main className="app__content">
        {statusMessage && (
          <div className={`status status--floating${error ? ' status--error' : ''}`}>
            <p>{statusMessage}</p>
            {error && <p className="status__details">{error}</p>}
          </div>
        )}

        <ArtworkCanvas
          artworks={artworks}
          ensureIndex={ensureIndex}
          hasMore={hasMore}
          loading={loading}
          onSelect={setSelected}
        />
      </main>

      <ArtworkModal artwork={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

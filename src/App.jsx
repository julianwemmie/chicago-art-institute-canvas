import { useCallback, useEffect, useRef, useState } from 'react';
import ArtworkGrid from './components/ArtworkGrid.jsx';
import ArtworkModal from './components/ArtworkModal.jsx';

const PAGE_SIZE = 60;
const API_URL = 'https://api.artic.edu/api/v1/artworks';
const FIELDS = ['id', 'title', 'image_id', 'artist_display', 'date_display', 'thumbnail', 'medium_display'];

const buildImageUrl = (imageId, size = 400) =>
  imageId ? `https://www.artic.edu/iiif/2/${imageId}/full/${size},/0/default.jpg` : null;

export default function App() {
  const [artworks, setArtworks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const didLoadRef = useRef(false);

  const fetchArtworks = useCallback(async () => {
    if (loading || didLoadRef.current) {
      return;
    }

    didLoadRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const url = new URL(API_URL);
      // @ts-ignore
      url.searchParams.set('limit', PAGE_SIZE);
      url.searchParams.set('fields', FIELDS.join(','));
      url.searchParams.set('page', '1');

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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    fetchArtworks();
  }, [fetchArtworks]);

  const showEmptyState = !loading && !error && artworks.length === 0;
  const showError = Boolean(error);

  return (
    <div className="app">
      <ArtworkGrid
        artworks={artworks}
        onSelect={(artwork) => setSelected(artwork)}
      />

      <div className="app__chrome" aria-live="polite" aria-atomic="true">
        <header className="app__header">
          <h1>Art Institute Explorer</h1>
          <p>Scroll through an endless wall of art and tap a tile for details.</p>
        </header>

        <div className="app__status-stack">
          {showError && (
            <div className="status status--error">
              <p>There was a problem loading artwork. Please try again.</p>
              <p className="status__details">{error}</p>
            </div>
          )}

          {showEmptyState && (
            <div className="status">
              <p>No artwork found right now. Please try again later.</p>
            </div>
          )}

          {loading && (
            <div className="status">
              <p>Loading more artwork…</p>
            </div>
          )}
        </div>
      </div>

      <ArtworkModal
        artwork={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

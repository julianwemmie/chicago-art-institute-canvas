const API_URL = 'https://api.artic.edu/api/v1/artworks';
const FIELDS = ['id', 'title', 'image_id', 'artist_display', 'date_display', 'thumbnail', 'medium_display'];

const buildImageUrl = (imageId, size = 400) =>
  imageId ? `https://www.artic.edu/iiif/2/${imageId}/full/${size},/0/default.jpg` : null;

const normalizeArtwork = (item) => {
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
};

async function fetchArtworksPage(page, limit) {
  const url = new URL(API_URL);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('fields', FIELDS.join(','));
  url.searchParams.set('page', String(page));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const data = await response.json();
  const artworks = data.data.filter((item) => item.image_id).map(normalizeArtwork);

  return {
    artworks,
    totalPages: data?.pagination?.total_pages ?? null,
  };
}

export { fetchArtworksPage };

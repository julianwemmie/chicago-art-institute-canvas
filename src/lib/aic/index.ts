import { IIIF_IMAGE_SIZE } from '../constants';

const API_ENDPOINT = 'https://api.artic.edu/api/v1/artworks';
const FIELDS = ['id', 'title', 'artist_title', 'image_id'] as const;
const PAGE_LIMIT = 100;

export interface ArtworkRef {
  id: number;
  imageId: string;
  title?: string | null;
  artist?: string | null;
}

interface AICArtworkPayload {
  id: number;
  title?: string | null;
  artist_title?: string | null;
  image_id?: string | null;
}

interface AICResponse {
  data: AICArtworkPayload[];
  config?: {
    iiif_url?: string;
  };
  pagination?: {
    current_page: number;
    total_pages: number;
    next_url?: string | null;
  };
}

export interface ArtworksPageResult {
  artworks: ArtworkRef[];
  hasMore: boolean;
  nextPage: number | null;
  iiifBase: string | null;
}

export function buildIiifImageUrl(
  iiifBase: string,
  imageId: string,
  size: string = IIIF_IMAGE_SIZE
): string {
  return `${iiifBase}/${imageId}/full/${size}/0/default.jpg`;
}

export async function fetchArtworksPage(page: number): Promise<ArtworksPageResult> {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(PAGE_LIMIT));
  url.searchParams.set('fields', FIELDS.join(','));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`AIC request failed: ${response.status}`);
  }

  const payload = (await response.json()) as AICResponse;
  const iiifBase = payload.config?.iiif_url ?? null;

  const artworks: ArtworkRef[] = (payload.data ?? [])
    .filter((item) => Boolean(item.image_id))
    .map((item) => ({
      id: item.id,
      imageId: item.image_id as string,
      title: item.title ?? null,
      artist: item.artist_title ?? null,
    }));

  const pagination = payload.pagination;
  const hasMore = Boolean(pagination && pagination.current_page < pagination.total_pages);
  const nextPage = hasMore && pagination ? pagination.current_page + 1 : null;

  return {
    artworks,
    hasMore,
    nextPage,
    iiifBase,
  };
}

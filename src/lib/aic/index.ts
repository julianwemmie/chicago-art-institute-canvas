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

function extractPageFromUrl(url: string | null | undefined): number | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const page = parsed.searchParams.get('page');
    if (!page) {
      return null;
    }

    const parsedNumber = Number(page);
    return Number.isFinite(parsedNumber) ? parsedNumber : null;
  } catch {
    return null;
  }
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
  const currentPage = pagination?.current_page ?? 0;
  const totalPages = pagination?.total_pages ?? 0;
  const nextPageFromUrl = extractPageFromUrl(pagination?.next_url ?? null);
  const hasMore = Boolean(pagination?.next_url) || currentPage < totalPages;
  const nextPage = hasMore
    ? nextPageFromUrl ?? (pagination ? currentPage + 1 : null)
    : null;

  return {
    artworks,
    hasMore,
    nextPage,
    iiifBase,
  };
}

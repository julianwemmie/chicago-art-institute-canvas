# Art Institute Explorer — Agents Guide

## Project snapshot
- React + Vite single-page app that loads artwork from the Art Institute of Chicago API (`https://api.artic.edu/api/v1/artworks`).
- Infinite scrolling grid of thumbnail tiles; selecting a tile opens a modal with richer artwork details and a higher resolution image.
- State includes `artworks`, pagination (`page`, `hasMore`), fetch status flags (`loading`, `error`), and the currently `selected` artwork.

## Anatomy of the UI
- `src/App.jsx`: bootstraps data fetching, manages pagination + intersection observer, renders the header, grid, loading/error states, and modal.
- `src/components/ArtworkGrid.jsx`: renders a responsive grid of buttons; each button shows a thumbnail and forwards selection events.
- `src/components/ArtworkModal.jsx`: modal dialog that preloads the hi-res image, falls back to the thumbnail, and shows title/artist/date/medium.
- `src/styles.css`: global styles for layout (grid, modal, typography, animations).
- `src/main.jsx`: Vite entry point that mounts `<App />` and imports styles.

## Data + behavior
- Fetch batches of 30 items (`PAGE_SIZE`) and request only the fields listed in `FIELDS`.
- Filters out artworks without `image_id` to avoid blank tiles.
- Deduplicates items client-side to guard against API overlaps.
- Infinite scroll driven by an `IntersectionObserver` tied to a sentinel div at the bottom of the page.
- Modal listens for `Escape` key, click on backdrop, and cleans up event listeners + image preloads on unmount.

## Running locally
- `npm install` then `npm run dev`; Vite serves at `http://localhost:5173`.
- Additional scripts: `npm run build` (production bundle) and `npm run preview` (serve built assets).

## Notes for future agents
- `buildImageUrl(imageId, size)` centralizes IIIF image URLs; pass `size=800` for large modal images.
- Consider API rate limits; guard additional changes with throttling/backoff if needed.
- Styling assumes modern browsers; any accessibility changes should keep focus trapping in mind for the modal.

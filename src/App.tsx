import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { PannableGrid, GridItem, Viewport } from "./components/PannableGrid";
import { computeMasonryLayout, MasonryImage } from "./lib/masonry";

export default function App(): JSX.Element {
  const sampleItems: GridItem[] = [
    {
      id: "origin",
      x: 0,
      y: 0,
      content: (
        <div style={pinStyle}>
          <strong>Origin</strong>
        </div>
      ),
    },
    {
      id: "gallery",
      x: 400,
      y: 200,
      content: (
        <div style={{ ...pinStyle, background: "#4caf50" }}>
          Gallery
        </div>
      ),
    },
    {
      id: "museum",
      x: -300,
      y: 450,
      content: (
        <div style={{ ...pinStyle, background: "#ff9800" }}>
          Museum
        </div>
      ),
    },
    {
      id: '4',
      x: 300,
      y: 300,
      content: (
        <img 
          src="https://www.artic.edu/iiif/2/25c31d8d-21a4-9ea1-1d73-6a2eca4dda7e/full/1686,/0/default.jpg" 
          width={300}
        />
      )
    },
    {
      id: '5',
      x: 500,
      y: 500,
      content: (
        <img 
          src="https://www.artic.edu/iiif/2/25c31d8d-21a4-9ea1-1d73-6a2eca4dda7e/full/1686,/0/default.jpg" 
          width={300}
        />
      )
    }
  ];

  async function fetchAICImages(limit = 25, page = 1): Promise<MasonryImage[]> {
    const baseApi = "https://api.artic.edu/api/v1/artworks";
    const iiifBase = "https://www.artic.edu/iiif/2";

    // Request a batch of artworks
    const url = `${baseApi}?page=${page}&limit=${limit}&fields=id,title,image_id`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AIC API error: ${res.statusText}`);
    const data = await res.json();

    const artworks = (data.data as Array<{ id: number; title: string; image_id: string | null }>).filter(
      (a) => a.image_id
    );

    // Fetch IIIF metadata in parallel (for aspect ratio)
    const images = await Promise.all(
      artworks.map(async (a) => {
        const infoUrl = `${iiifBase}/${a.image_id}/info.json`;
        try {
          const infoRes = await fetch(infoUrl);
          if (!infoRes.ok) throw new Error("No IIIF info");
          const info = await infoRes.json();
          const { width, height } = info;
          const aspectRatio = width / height;
          const imageUrl = `${iiifBase}/${a.image_id}/full/843,/0/default.jpg`;

          return {
            id: a.id,
            width: 400,
            height: 400 / aspectRatio,
            aspectRatio,
            content: (
              <img
                src={imageUrl}
                alt={a.title}
                width={400}
                loading="eager"
              />
            ),
          } as MasonryImage;
        } catch {
          // Fallback: skip or assign default ratio
          return null;
        }
      })
    );

    return images.filter((x): x is MasonryImage => !!x);
  }

  const [images, setImages] = useState<MasonryImage[]>([]);

  useEffect(() => {
    fetchAICImages(35)
      .then((images) => setImages(images))
  },[])

  const COLUMN_WIDTH = 400;
  const COL_GAP = 16;
  const ROW_GAP = 16;

  async function getItems(view: { x: number; y: number; width: number; height: number }) {
    const candidates = images

    const { items } = computeMasonryLayout(candidates, {
      columnWidth: COLUMN_WIDTH,
      columnGap: COL_GAP,
      rowGap: ROW_GAP,
      bounds: {x:-800,y:-800,width:view.width+1600,height:view.height+1600},     // world window from PannableGrid
      // columnCount: 5, // optional; otherwise derived from view.width
      // initialColumnHeights, // optional; seed if continuing from previous page
      align: 'start',
    })

    console.log(view)

    return items;
  }

  return (
    <div className="app">
      <PannableGrid
        // items={sampleItems}
        getItems={getItems}
        // initialOffset={{ x: -100, y: -100 }}
        overscan={1000}
        debug
      />
    </div>
  );
}

const pinStyle: CSSProperties = {
  background: "#1976d2",
  color: "#fff",
  padding: "8px 12px",
  borderRadius: 8,
  boxShadow: "0 4px 10px rgba(0,0,0,0.25)",
  minWidth: 80,
  textAlign: "center",
};

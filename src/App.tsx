import { type CSSProperties } from "react";
import { PannableGrid, GridItem, Viewport } from "./components/PannableGrid";

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

  return (
    <div className="app">
      <PannableGrid
        items={sampleItems}
        initialOffset={{ x: -100, y: -100 }}
        overscan={400}
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

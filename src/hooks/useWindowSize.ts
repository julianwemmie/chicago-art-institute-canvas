import { useEffect, useState } from 'react';

interface WindowSize {
  width: number;
  height: number;
}

const DEFAULT_SIZE: WindowSize = {
  width: 1024,
  height: 768,
};

export function useWindowSize(): WindowSize {
  const [size, setSize] = useState<WindowSize>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_SIZE;
    }
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let frame = 0;
    const handleResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setSize({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return size;
}

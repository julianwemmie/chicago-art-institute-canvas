const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
const supportsContentVisibility =
  isBrowser && 'contentVisibility' in document.documentElement.style;
const supportsContain = isBrowser && 'contain' in document.documentElement.style;
const DEFAULT_DEBOUNCE_MS = 150;

/**
 * @typedef {Object} MasonryBreakpoint
 * @property {number} minWidth Minimum viewport width in pixels.
 * @property {number} columns Number of columns when viewport is >= minWidth.
 */

/**
 * @typedef {Object} MasonryOptions
 * @property {HTMLElement} container Relative-positioned container element.
 * @property {string} itemSelector CSS selector for child items.
 * @property {number} columnWidth Base width for every column (px).
 * @property {number} [gutterX=16] Horizontal gap between columns.
 * @property {number} [gutterY=16] Vertical gap between items.
 * @property {MasonryBreakpoint[]} [breakpoints] Optional responsive rules sorted asc.
 */

/**
 * @typedef {Object} MasonryController
 * @property {() => void} relayout Force a synchronous layout pass.
 * @property {() => void} destroyMasonry Tear down listeners and inline styles.
 */

/**
 * Creates a masonry controller that positions variable-height tiles into columns.
 * @param {MasonryOptions} options
 * @returns {MasonryController}
 */
export function initMasonry(options) {
  if (!isBrowser) {
    throw new Error('initMasonry can only run in a browser environment');
  }

  const config = validateConfig(options);
  const instance = createInstance(config);
  instance.mount();

  return {
    relayout: () => instance.scheduleLayout({ immediate: true }),
    destroyMasonry: () => instance.destroy(),
  };
}

function validateConfig(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('initMasonry requires an options object');
  }

  const {
    container,
    itemSelector,
    columnWidth,
    gutterX = 16,
    gutterY = 16,
    breakpoints = [],
  } = options;

  if (typeof HTMLElement === 'undefined' || !(container instanceof HTMLElement)) {
    throw new Error('container must be an HTMLElement');
  }

  if (!itemSelector || typeof itemSelector !== 'string') {
    throw new Error('itemSelector must be a non-empty string');
  }

  if (!Number.isFinite(columnWidth) || columnWidth <= 0) {
    throw new Error('columnWidth must be a positive number');
  }

  if (!Number.isFinite(gutterX) || gutterX < 0) {
    throw new Error('gutterX must be a non-negative number');
  }

  if (!Number.isFinite(gutterY) || gutterY < 0) {
    throw new Error('gutterY must be a non-negative number');
  }

  const normalizedBreakpoints = Array.isArray(breakpoints)
    ? breakpoints.map((bp) => ({
        minWidth: Number(bp?.minWidth) || 0,
        columns: Number(bp?.columns) || 0,
      }))
    : [];

  for (const bp of normalizedBreakpoints) {
    if (bp.minWidth < 0 || bp.columns < 1) {
      throw new Error('breakpoints must include positive columns and non-negative minWidth values');
    }
  }

  for (let i = 1; i < normalizedBreakpoints.length; i += 1) {
    if (normalizedBreakpoints[i - 1].minWidth > normalizedBreakpoints[i].minWidth) {
      throw new Error('breakpoints must be sorted in ascending order by minWidth');
    }
  }

  return {
    container,
    itemSelector: itemSelector.trim(),
    columnWidth,
    gutterX,
    gutterY,
    breakpoints: normalizedBreakpoints,
  };
}

function createInstance(config) {
  let heightCache = new WeakMap();
  const preparedItems = new WeakSet();
  const imageListeners = new Map();
  const state = {
    destroyed: false,
    rafId: null,
    appliedColumnWidth: null,
    resizeHandler: null,
    observer: null,
    forcedPosition: false,
    originalContainerStyles: {
      position: config.container.style.position,
      height: config.container.style.height,
    },
  };

  const scheduleLayout = ({ immediate = false } = {}) => {
    if (state.destroyed) {
      return;
    }

    if (immediate) {
      if (state.rafId !== null) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }
      performLayout();
      return;
    }

    if (state.rafId !== null) {
      return;
    }

    state.rafId = requestAnimationFrame(() => {
      state.rafId = null;
      performLayout();
    });
  };

  const destroy = () => {
    if (state.destroyed) {
      return;
    }
    state.destroyed = true;

    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
    }

    if (state.resizeHandler) {
      window.removeEventListener('resize', state.resizeHandler);
    }

    if (state.observer) {
      state.observer.disconnect();
    }

    for (const [img, handler] of imageListeners.entries()) {
      img.removeEventListener('load', handler);
      img.removeEventListener('error', handler);
    }
    imageListeners.clear();

    // Reset inline styles for items we modified.
    const items = config.container.querySelectorAll(config.itemSelector);
    items.forEach((item) => {
      ['position', 'display', 'width', 'transform', 'willChange', 'contain', 'contentVisibility'].forEach(
        (prop) => {
          item.style[prop] = '';
        }
      );
    });

    if (state.forcedPosition) {
      config.container.style.position = state.originalContainerStyles.position;
    }

    config.container.style.height = state.originalContainerStyles.height;
  };

  const attachMutationObserver = () => {
    if (typeof MutationObserver === 'undefined') {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      let shouldRelayout = false;
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }

          if (node.matches(config.itemSelector)) {
            prepareItem(node);
            watchImages(node);
            shouldRelayout = true;
          } else {
            const nestedMatches = node.querySelectorAll?.(config.itemSelector);
            nestedMatches?.forEach((match) => {
              prepareItem(match);
              watchImages(match);
              shouldRelayout = true;
            });
          }
        });
      }

      if (shouldRelayout) {
        scheduleLayout();
      }
    });

    observer.observe(config.container, { childList: true, subtree: true });
    state.observer = observer;
  };

  const mount = () => {
    const computed = window.getComputedStyle(config.container);
    if (computed.position === 'static') {
      config.container.style.position = 'relative';
      state.forcedPosition = true;
    }

    state.resizeHandler = debounce(() => scheduleLayout(), DEFAULT_DEBOUNCE_MS);
    window.addEventListener('resize', state.resizeHandler);

    attachMutationObserver();
    scheduleLayout({ immediate: true });
  };

  const prepareItem = (item, colWidth = state.appliedColumnWidth) => {
    if (!item || !(item instanceof HTMLElement)) {
      return;
    }

    item.style.position = 'absolute';
    item.style.display = 'block';
    if (colWidth != null) {
      item.style.width = `${colWidth}px`;
    }
    item.style.willChange = 'transform';
    if (supportsContain) {
      item.style.contain = 'layout paint';
    }
    if (supportsContentVisibility) {
      item.style.contentVisibility = 'auto';
    }
    preparedItems.add(item);
  };

  const prepareItems = (items, colWidth) => {
    const widthChanged = state.appliedColumnWidth !== colWidth;
    if (widthChanged) {
      heightCache = new WeakMap();
    }

    items.forEach((item) => {
      if (!preparedItems.has(item) || widthChanged) {
        prepareItem(item, colWidth);
      }
    });
    state.appliedColumnWidth = colWidth;
  };

  const watchImages = (item) => {
    const img = item.querySelector('img');
    if (!img) {
      return;
    }

    if (img.complete && img.naturalHeight > 0) {
      return;
    }

    if (imageListeners.has(img)) {
      return;
    }

    const handleLoad = () => {
      imageListeners.delete(img);
      const host = img.closest(config.itemSelector);
      if (host) {
        heightCache.delete(host);
      }
      scheduleLayout();
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleLoad);
    };

    imageListeners.set(img, handleLoad);
    img.addEventListener('load', handleLoad);
    img.addEventListener('error', handleLoad);
  };

  const performLayout = () => {
    if (state.destroyed) {
      return;
    }

    const items = Array.from(config.container.querySelectorAll(config.itemSelector));
    if (items.length === 0) {
      config.container.style.height = state.originalContainerStyles.height;
      return;
    }

    const containerWidth = Math.floor(config.container.clientWidth);
    if (containerWidth === 0) {
      return;
    }

    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || containerWidth;
    const columnCount = resolveColumnCount(containerWidth, viewportWidth, config);
    const colWidth = Math.min(config.columnWidth, Math.max(1, containerWidth));
    prepareItems(items, colWidth);
    items.forEach(watchImages);

    const measurements = new Map();
    const needsMeasurement = [];

    items.forEach((item) => {
      const cachedHeight = heightCache.get(item);
      if (cachedHeight != null) {
        measurements.set(item, cachedHeight);
        return;
      }

      const predicted = estimateHeightFromAspect(item, colWidth);
      if (predicted != null) {
        measurements.set(item, predicted);
        heightCache.set(item, predicted);
      } else {
        needsMeasurement.push(item);
      }
    });

    if (needsMeasurement.length > 0) {
      needsMeasurement.forEach((item) => {
        const rect = item.getBoundingClientRect();
        const measured = Math.round(rect.height);
        measurements.set(item, measured);
        heightCache.set(item, measured);
      });
    }

    const columnHeights = new Array(columnCount).fill(0);
    const xPositions = new Array(columnCount)
      .fill(0)
      .map((_, index) => index * (colWidth + config.gutterX));
    let tallest = 0;

    items.forEach((item) => {
      const height = measurements.get(item) ?? 0;
      const targetColumn = findShortestColumn(columnHeights);
      const baseY = columnHeights[targetColumn];
      const y = baseY === 0 ? 0 : baseY + config.gutterY;
      const x = xPositions[targetColumn];
      const nextHeight = y + height;

      item.style.transform = `translate3d(${x}px, ${y}px, 0)`;

      columnHeights[targetColumn] = nextHeight;
      tallest = Math.max(tallest, nextHeight);
    });

    config.container.style.height = `${tallest}px`;
  };

  return {
    mount,
    destroy,
    scheduleLayout,
  };
}

function resolveColumnCount(containerWidth, viewportWidth, config) {
  let columns = 0;
  if (config.breakpoints.length > 0) {
    for (const breakpoint of config.breakpoints) {
      if (viewportWidth >= breakpoint.minWidth) {
        columns = breakpoint.columns;
      }
    }
  }

  if (columns <= 0) {
    columns = Math.floor((containerWidth + config.gutterX) / (config.columnWidth + config.gutterX));
  }

  if (!Number.isFinite(columns) || columns < 1) {
    columns = 1;
  }

  const maxColumnsByWidth = Math.max(
    1,
    Math.floor((containerWidth + config.gutterX) / (config.columnWidth + config.gutterX))
  );

  return Math.max(1, Math.min(columns, maxColumnsByWidth));
}

function estimateHeightFromAspect(item, colWidth) {
  const aspect = item.dataset?.aspect;
  if (!aspect) {
    return null;
  }

  const cleaned = aspect.replace(/\s+/g, '');
  if (!cleaned) {
    return null;
  }

  const parts = cleaned.split(/[/:x]/i).filter(Boolean);
  let ratio = null;
  if (parts.length >= 2) {
    const width = parseFloat(parts[0]);
    const height = parseFloat(parts[1]);
    if (width > 0 && height > 0) {
      ratio = height / width;
    }
  } else if (parts.length === 1) {
    const numericRatio = parseFloat(parts[0]);
    if (numericRatio > 0) {
      ratio = numericRatio;
    }
  }

  if (!ratio) {
    return null;
  }

  return Math.round(colWidth * ratio);
}

function findShortestColumn(heights) {
  let shortestIndex = 0;
  let shortestValue = heights[0];
  for (let i = 1; i < heights.length; i += 1) {
    if (heights[i] < shortestValue) {
      shortestValue = heights[i];
      shortestIndex = i;
    }
  }
  return shortestIndex;
}

function debounce(fn, wait = DEFAULT_DEBOUNCE_MS) {
  let timeout = null;
  return (...args) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = null;
      fn(...args);
    }, wait);
  };
}

/*
Example usage:
const controller = initMasonry({
  container: document.querySelector('.masonry'),
  itemSelector: '.masonry-item',
  columnWidth: 280,
  gutterX: 16,
  gutterY: 16,
  breakpoints: [
    { minWidth: 1280, columns: 4 },
    { minWidth: 960, columns: 3 },
    { minWidth: 0, columns: 2 },
  ],
});
controller.relayout();
controller.destroyMasonry();

Notes:
- Layout is recalculated when the window resizes, new nodes are added, or tracked images finish loading.
- IntersectionObserver-based deferral is not implemented; all items are measured eagerly when inserted.
- Designed for evergreen browsers (Chromium, Firefox, Safari 15+) with support for transforms and requestAnimationFrame.
*/

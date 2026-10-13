/**
 * Annotations in the page model, plus the viewport geometry used while
 * dragging them. Pure functions; no DOM.
 *
 * Annotations live on their page entry (`entry.annotations`, absent = none),
 * so they follow the page through reorder, rotation, merge and deletion.
 * Each one is anchored in the SOURCE page's PDF user space (bottom-left
 * origin, points) — independent of zoom and of the page's display rotation:
 *
 *   { id: string, type: 'marker' | 'text' | 'image', rect: { x, y, width, height }, … }
 *
 * Text adds its content/style (lib/textLayout.js). Images add
 *   { rotate, image: { id, bytes, mime, width, height, url } }
 * where `rotate` is the orientation fixed at placement (see ownFrame.js),
 * `image.width/height` are pixels and `url` is an object URL for preview.
 *
 * Conversion to/from the screen is done with lib/coords.js.
 */

/** Smallest annotation side, in viewport px, while resizing. */
export const MIN_SIZE_PX = 12;

/** Default size for a click-placed marker, in PDF points. */
export const DEFAULT_MARKER_SIZE = { width: 120, height: 48 };

let counter = 0;
/** Unique-enough id for a new annotation within this session. */
export function newAnnotationId() {
  counter += 1;
  return `a${Date.now().toString(36)}${counter}`;
}

export const getAnnotations = (page) => page?.annotations ?? [];

/** Append `annotation` to the page with id `pageId`. */
export function addAnnotation(pages, pageId, annotation) {
  return pages.map((page) =>
    page.id === pageId
      ? { ...page, annotations: [...getAnnotations(page), annotation] }
      : page
  );
}

/** Find an annotation and the page it's on, or null. */
export function findAnnotation(pages, annotationId) {
  for (const page of pages) {
    const annotation = getAnnotations(page).find((a) => a.id === annotationId);
    if (annotation) return { page, annotation };
  }
  return null;
}

/** Apply `patch` (e.g. { rect }) to one annotation. Unchanged pages are reused. */
export function updateAnnotation(pages, annotationId, patch) {
  let changed = false;
  const next = pages.map((page) => {
    const list = getAnnotations(page);
    if (!list.some((a) => a.id === annotationId)) return page;
    changed = true;
    return {
      ...page,
      annotations: list.map((a) => (a.id === annotationId ? { ...a, ...patch } : a)),
    };
  });
  return changed ? next : pages;
}

/** Remove one annotation. */
export function removeAnnotation(pages, annotationId) {
  let changed = false;
  const next = pages.map((page) => {
    const list = getAnnotations(page);
    if (!list.some((a) => a.id === annotationId)) return page;
    changed = true;
    return { ...page, annotations: list.filter((a) => a.id !== annotationId) };
  });
  return changed ? next : pages;
}

// ---------------------------------------------------------------------------
// Viewport-space geometry (px, top-left origin) for interactive editing.
// `bounds` is the rendered page: { width, height }.
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Keep a rect inside the page, shrinking it only if it's larger than the page. */
export function clampRectToBounds(rect, bounds) {
  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  return {
    x: clamp(rect.x, 0, bounds.width - width),
    y: clamp(rect.y, 0, bounds.height - height),
    width,
    height,
  };
}

/** Translate by (dx, dy), stopping at the page edges. */
export function moveRect(rect, dx, dy, bounds) {
  return clampRectToBounds({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds);
}

/**
 * Drag one corner handle ('nw' | 'ne' | 'sw' | 'se') by (dx, dy). The
 * opposite corner stays put; the moving edges stop at the page edges and at
 * `minSize` from the fixed edges.
 */
export function resizeRect(rect, handle, dx, dy, bounds, minSize = MIN_SIZE_PX) {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;

  if (handle.includes('w')) left = clamp(left + dx, 0, right - minSize);
  if (handle.includes('e')) right = clamp(right + dx, left + minSize, bounds.width);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minSize);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minSize, bounds.height);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Normalised rect spanning two drag points. */
export function rectFromPoints(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** A `size` rect (px) centred on `point`, kept inside the page. */
export function rectCenteredAt(point, size, bounds) {
  return clampRectToBounds(
    {
      x: point.x - size.width / 2,
      y: point.y - size.height / 2,
      width: size.width,
      height: size.height,
    },
    bounds
  );
}

/**
 * Like resizeRect, but keeps the rect's aspect ratio (for images). The
 * opposite corner stays put; the size follows whichever axis was dragged
 * further, limited by `minSize` and by the page edges.
 */
export function resizeRectLocked(rect, handle, dx, dy, bounds, minSize = MIN_SIZE_PX) {
  const sx = handle.includes('e') ? 1 : -1; // which way the moving corner grows
  const sy = handle.includes('s') ? 1 : -1;
  const fixedX = sx > 0 ? rect.x : rect.x + rect.width;
  const fixedY = sy > 0 ? rect.y : rect.y + rect.height;

  // Proposed scale: the larger relative change of the two axes.
  const scaleX = (rect.width + sx * dx) / rect.width;
  const scaleY = (rect.height + sy * dy) / rect.height;
  let scale = Math.max(scaleX, scaleY);

  const minScale = Math.max(minSize / rect.width, minSize / rect.height);
  const roomX = sx > 0 ? bounds.width - fixedX : fixedX;
  const roomY = sy > 0 ? bounds.height - fixedY : fixedY;
  const maxScale = Math.min(roomX / rect.width, roomY / rect.height);
  scale = clamp(scale, Math.min(minScale, maxScale), maxScale);

  const width = rect.width * scale;
  const height = rect.height * scale;
  return {
    x: sx > 0 ? fixedX : fixedX - width,
    y: sy > 0 ? fixedY : fixedY - height,
    width,
    height,
  };
}

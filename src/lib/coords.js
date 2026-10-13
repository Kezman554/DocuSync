/**
 * Coordinate mapping between the rendered page preview and PDF space.
 *
 * Viewport space (what the user sees and clicks):
 *   - origin at the top-left of the rendered page, y grows downward
 *   - units are CSS pixels at the current zoom: 1 PDF unit = `scale` px
 *     (pass `scale * devicePixelRatio` to work in canvas backing pixels)
 *   - the page is shown rotated clockwise by `rotation` degrees
 *
 * PDF space (what pdf-lib draws in):
 *   - the page's user space: origin bottom-left, y grows upward, units are
 *     points (1/72 in), unaffected by /Rotate
 *   - the visible page is `pageBox` ({ x, y, width, height }), which may not
 *     start at (0, 0) — e.g. a CropBox of [10 20 622 812]
 *
 * This matches pdf.js's PageViewport transform for the same box, scale and
 * rotation, so points line up with what pdf.js rendered.
 *
 * `rotation` is the page's TOTAL rotation — intrinsic /Rotate plus the user's
 * edit (see effectiveRotation in pageModel.js).
 *
 * Pure functions, no DOM or library dependencies.
 */

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ pageBox: Rect, scale: number, rotation: number }} View
 */

/** Normalise any multiple of 90 into 0 | 90 | 180 | 270; reject others. */
export function normalizeQuarterTurn(degrees) {
  if (!Number.isFinite(degrees) || degrees % 90 !== 0) {
    throw new RangeError(`Rotation must be a multiple of 90°, got ${degrees}`);
  }
  return ((degrees % 360) + 360) % 360;
}

/** pdf.js `page.view` ([x0, y0, x1, y1]) → { x, y, width, height }. */
export function pageBoxFromView([x0, y0, x1, y1]) {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

function check({ pageBox, scale, rotation }) {
  if (!(scale > 0)) throw new RangeError(`Scale must be positive, got ${scale}`);
  if (!pageBox || !(pageBox.width > 0) || !(pageBox.height > 0)) {
    throw new RangeError('pageBox must have a positive width and height');
  }
  return normalizeQuarterTurn(rotation);
}

/** Size of the rendered page in viewport px (width/height swap at 90°/270°). */
export function viewportSize(view) {
  const rotation = check(view);
  const { pageBox, scale } = view;
  const sideways = rotation === 90 || rotation === 270;
  return {
    width: (sideways ? pageBox.height : pageBox.width) * scale,
    height: (sideways ? pageBox.width : pageBox.height) * scale,
  };
}

/** Viewport point (top-left origin, px) → PDF point (bottom-left origin, pt). */
export function viewportToPdfPoint({ x, y }, view) {
  const rotation = check(view);
  const { pageBox: box, scale } = view;
  // Undo zoom, then undo the clockwise display rotation to get (u, w):
  // distances from the unrotated page's left edge and top edge.
  const vx = x / scale;
  const vy = y / scale;
  let u;
  let w;
  switch (rotation) {
    case 0:
      u = vx;
      w = vy;
      break;
    case 90:
      u = vy;
      w = box.height - vx;
      break;
    case 180:
      u = box.width - vx;
      w = box.height - vy;
      break;
    default: // 270
      u = box.width - vy;
      w = vx;
  }
  return { x: box.x + u, y: box.y + box.height - w };
}

/** PDF point (bottom-left origin, pt) → viewport point (top-left origin, px). */
export function pdfToViewportPoint({ x, y }, view) {
  const rotation = check(view);
  const { pageBox: box, scale } = view;
  const u = x - box.x; // from the left edge
  const w = box.y + box.height - y; // from the top edge
  let vx;
  let vy;
  switch (rotation) {
    case 0:
      vx = u;
      vy = w;
      break;
    case 90:
      vx = box.height - w;
      vy = u;
      break;
    case 180:
      vx = box.width - u;
      vy = box.height - w;
      break;
    default: // 270
      vx = w;
      vy = box.width - u;
  }
  return { x: vx * scale, y: vy * scale };
}

/** Axis-aligned bounds of two opposite corners. */
function boundsOf(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Viewport rect (top-left x/y, px) → PDF rect (bottom-left x/y, pt).
 * Under 90°/270° rotation width and height swap, since the page is sideways.
 */
export function viewportToPdfRect(rect, view) {
  return boundsOf(
    viewportToPdfPoint({ x: rect.x, y: rect.y }, view),
    viewportToPdfPoint({ x: rect.x + rect.width, y: rect.y + rect.height }, view)
  );
}

/** PDF rect (bottom-left x/y, pt) → viewport rect (top-left x/y, px). */
export function pdfToViewportRect(rect, view) {
  return boundsOf(
    pdfToViewportPoint({ x: rect.x, y: rect.y }, view),
    pdfToViewportPoint({ x: rect.x + rect.width, y: rect.y + rect.height }, view)
  );
}

/**
 * Where to draw content with pdf-lib so it appears UPRIGHT in a viewport rect,
 * even on a rotated page.
 *
 * Returns options for `page.drawImage(img, opts)` / `drawText`:
 *   - `width`/`height`: the content's own size in pt (as seen by the user)
 *   - `x`/`y`: the content's own bottom-left corner in PDF space — the rect's
 *     visual bottom-left — which pdf-lib rotates around
 *   - `rotate`: counter-clockwise degrees (pdf-lib's convention) that cancel
 *     the page's clockwise display rotation; wrap with pdf-lib `degrees()`
 */
export function viewportRectToPdfPlacement(rect, view) {
  const rotation = check(view);
  const anchor = viewportToPdfPoint({ x: rect.x, y: rect.y + rect.height }, view);
  return {
    x: anchor.x,
    y: anchor.y,
    width: rect.width / view.scale,
    height: rect.height / view.scale,
    rotate: rotation,
  };
}

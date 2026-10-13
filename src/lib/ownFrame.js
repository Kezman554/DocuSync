/**
 * "Own frame" geometry for annotation content (text, images) that has its
 * own orientation on the page.
 *
 * The own frame is the content's coordinates before rotation: x to the right
 * along the content, y up, origin at its bottom-left. In PDF space the
 * content is turned `rotate`° counter-clockwise (pdf-lib's convention) about
 * that origin — the "anchor", which is the x/y pdf-lib's drawText/drawImage
 * take together with `rotate`. `rect` is the content's axis-aligned bounds in
 * PDF space. Pure functions.
 */
import { normalizeQuarterTurn } from './coords.js';

const ROT = {
  0: [1, 0, 0, 1],
  90: [0, 1, -1, 0],
  180: [-1, 0, 0, -1],
  270: [0, -1, 1, 0],
};

/** The box's own width/height (bounds swap at 90°/270°). */
export function ownSize(rect, rotate) {
  const r = normalizeQuarterTurn(rotate);
  return r === 90 || r === 270
    ? { width: rect.height, height: rect.width }
    : { width: rect.width, height: rect.height };
}

/** PDF point of own-frame offset (ox along the text, oy up) from `anchor`. */
export function ownToPdf(anchor, rotate, ox, oy) {
  const [cos, sin] = ROT[normalizeQuarterTurn(rotate)];
  return { x: anchor.x + ox * cos - oy * sin, y: anchor.y + ox * sin + oy * cos };
}

/**
 * The box's own bottom-left corner in PDF space — the point pdf-lib rotates
 * around (`x`/`y` for drawText/drawImage with `rotate`).
 */
export function anchorOf(rect, rotate) {
  switch (normalizeQuarterTurn(rotate)) {
    case 0:
      return { x: rect.x, y: rect.y };
    case 90:
      return { x: rect.x + rect.width, y: rect.y };
    case 180:
      return { x: rect.x + rect.width, y: rect.y + rect.height };
    default: // 270
      return { x: rect.x, y: rect.y + rect.height };
  }
}

/** Bounds of an own-frame box of `width` × `height` anchored at `anchor`. */
export function rectFromAnchor(anchor, rotate, width, height) {
  const corners = [
    ownToPdf(anchor, rotate, 0, 0),
    ownToPdf(anchor, rotate, width, height),
  ];
  return {
    x: Math.min(corners[0].x, corners[1].x),
    y: Math.min(corners[0].y, corners[1].y),
    width: Math.abs(corners[1].x - corners[0].x),
    height: Math.abs(corners[1].y - corners[0].y),
  };
}

/** The box's own top-left corner (where the text starts) in PDF space. */
export function topLeftOf(rect, rotate) {
  return ownToPdf(anchorOf(rect, rotate), rotate, 0, ownSize(rect, rotate).height);
}

/** Bounds for a box whose own top-left is `topLeft` — used when text grows. */
export function rectFromTopLeft(topLeft, rotate, width, height) {
  return rectFromAnchor(ownToPdf(topLeft, rotate, 0, -height), rotate, width, height);
}


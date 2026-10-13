/**
 * Layout for text annotations, shared by the preview and the PDF export so
 * both put every line's baseline in exactly the same place.
 *
 * A text annotation (see lib/annotations.js) is:
 *   {
 *     id, type: 'text',
 *     text: string,                 lines split on "\n" only (no auto-wrap,
 *                                   which would differ between browser & PDF)
 *     font: 'Helvetica' | 'TimesRoman' | 'Courier',   pdf-lib StandardFonts
 *     fontSize: number,             points
 *     color: '#rrggbb',
 *     rotate: 0 | 90 | 180 | 270,   orientation of the text in PDF space,
 *                                   counter-clockwise (pdf-lib convention)
 *     rect: { x, y, width, height } axis-aligned bounds in PDF space
 *   }
 *
 * `rotate` is fixed when the text is placed (equal to the page's total
 * rotation then, so it reads upright); if the page is rotated afterwards the
 * text turns with the page, like any other page content.
 *
 * "Own frame": the text box's own coordinates before rotation — x to the
 * right along the text, y up, origin at the box's bottom-left. Pure module.
 */
import { normalizeQuarterTurn } from './coords.js';

/** Line box height as a multiple of font size (CSS-style leading). */
export const LINE_HEIGHT = 1.2;

/**
 * The three standard font families, with ascender/descender from their AFM
 * metrics (per 1000 em) and CSS stacks for an on-screen look-alike.
 */
export const STANDARD_FONTS = {
  Helvetica: {
    label: 'Helvetica',
    css: 'Helvetica, Arial, "Liberation Sans", sans-serif',
    ascender: 718,
    descender: -207,
  },
  TimesRoman: {
    label: 'Times',
    css: '"Times New Roman", Times, "Liberation Serif", serif',
    ascender: 683,
    descender: -217,
  },
  Courier: {
    label: 'Courier',
    css: '"Courier New", Courier, "Liberation Mono", monospace',
    ascender: 629,
    descender: -157,
  },
};

export const DEFAULT_TEXT_STYLE = { font: 'Helvetica', fontSize: 16, color: '#000000' };
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 144;

export const splitLines = (text) => (text ?? '').split(/\r\n|\r|\n/);

export function clampFontSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n)) return DEFAULT_TEXT_STYLE.fontSize;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(n * 2) / 2));
}

/**
 * Vertical layout in points: line height, total box height, and each line's
 * baseline measured DOWN from the top of the box. The glyphs (ascender to
 * descender) are centred in each line box, as CSS does.
 */
export function textLayout({ text, fontSize, font }) {
  const metrics = STANDARD_FONTS[font] ?? STANDARD_FONTS.Helvetica;
  const lines = splitLines(text);
  const lineHeight = fontSize * LINE_HEIGHT;
  const ascent = (metrics.ascender / 1000) * fontSize;
  const glyphHeight = ((metrics.ascender - metrics.descender) / 1000) * fontSize;
  const firstBaseline = (lineHeight - glyphHeight) / 2 + ascent;
  return {
    lines,
    lineHeight,
    height: lines.length * lineHeight,
    baselines: lines.map((_, i) => i * lineHeight + firstBaseline),
  };
}

/** Hex "#rrggbb" (or "#rgb") → { r, g, b } in 0..1 for pdf-lib rgb(). */
export function hexToRgb(hex) {
  let h = String(hex ?? '').replace(/^#/, '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return { r: 0, g: 0, b: 0 };
  const n = parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

// ---------------------------------------------------------------------------
// Own frame ↔ PDF space for a box rotated `rotate`° counter-clockwise.
// ---------------------------------------------------------------------------

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

/**
 * pdf-lib drawText calls for a text annotation: one per non-empty line, with
 * the baseline start point in PDF space and the shared rotation.
 */
export function textDrawOps(annotation) {
  const { lines, baselines } = textLayout(annotation);
  const { height } = ownSize(annotation.rect, annotation.rotate);
  const anchor = anchorOf(annotation.rect, annotation.rotate);
  return lines
    .map((line, i) => ({
      text: line,
      ...ownToPdf(anchor, annotation.rotate, 0, height - baselines[i]),
    }))
    .filter((op) => op.text.length > 0);
}

/**
 * Layout for text annotations, shared by the preview and the PDF export so
 * both put every line's baseline in exactly the same place.
 *
 * A text annotation (see lib/annotations.js) is:
 *   {
 *     id, type: 'text',
 *     text: string,                 lines split on "\n" only (no auto-wrap,
 *                                   which would differ between browser & PDF)
 *     font: key of STANDARD_FONTS (pdf-lib StandardFonts names)
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
 * Rotation geometry ("own frame" ↔ PDF space) lives in ownFrame.js. Pure.
 */
import { anchorOf, ownSize, ownToPdf } from './ownFrame.js';

// Own-frame helpers moved to ownFrame.js (shared with images); re-exported
// here for existing importers.
export {
  anchorOf,
  ownSize,
  ownToPdf,
  rectFromAnchor,
  rectFromTopLeft,
  topLeftOf,
} from './ownFrame.js';

/** Line box height as a multiple of font size (CSS-style leading). */
export const LINE_HEIGHT = 1.2;

/**
 * Standard PDF fonts we use, with ascender/descender from their AFM metrics
 * (per 1000 em; ZapfDingbats has none, so its FontBBox) and CSS for an
 * on-screen look-alike. `symbols` fonts (tick stamps) aren't offered in the
 * text font picker.
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
  HelveticaBold: {
    label: 'Helvetica Bold',
    css: 'Helvetica, Arial, "Liberation Sans", sans-serif',
    weight: 'bold',
    ascender: 718,
    descender: -207,
  },
  TimesRomanBoldItalic: {
    label: 'Times Bold Italic',
    css: '"Times New Roman", Times, "Liberation Serif", serif',
    style: 'italic',
    weight: 'bold',
    ascender: 683,
    descender: -217,
  },
  ZapfDingbats: {
    label: 'Symbols',
    css: '"Zapf Dingbats", "Segoe UI Symbol", "DejaVu Sans", "Apple Symbols", sans-serif',
    ascender: 820,
    descender: -143,
    symbols: true,
  },
};

/** CSS `font` shorthand for a standard font at `px` size. */
export function cssFont(font, px) {
  const f = STANDARD_FONTS[font] ?? STANDARD_FONTS.Helvetica;
  return `${f.style ?? 'normal'} ${f.weight ?? 'normal'} ${px}px ${f.css}`;
}

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

/**
 * Scale a text annotation's font size by `factor` (e.g. from dragging a
 * stamp's corner handle), clamped to the allowed range. Returns the new
 * font size and the factor actually applied, so the caller can scale the
 * box by the same amount.
 */
export function scaleFontSize(fontSize, factor) {
  const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSize * factor));
  return { fontSize: next, factor: next / fontSize };
}

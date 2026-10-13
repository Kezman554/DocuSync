/**
 * Watermarks: a text or image mark repeated across pages, semi-transparent
 * and rotated. Pure geometry; drawing happens in exportPdf (drawText /
 * drawImage with `opacity`) and in the viewer preview.
 *
 * Placement works in "shown" space — the page as displayed (after its total
 * rotation), points, origin bottom-left, y up — so the mark is centred and
 * angled the same way on every page however it's rotated. `angle` is
 * counter-clockwise as seen (45° rises to the right).
 */
import { normalizeQuarterTurn, viewportToPdfPoint } from './coords.js';
import { STANDARD_FONTS } from './textLayout.js';
import { parsePageRanges } from './pageRanges.js';

export const DEFAULT_WATERMARK = {
  type: 'text', // 'text' | 'image'
  text: 'DRAFT',
  font: 'HelveticaBold',
  fontSize: 'auto', // or a number of points
  color: '#808080',
  opacity: 0.25,
  angle: 45,
  /** Image width as a fraction of the shown page width. */
  imageScale: 0.5,
  image: null, // { id, bytes, mime, width, height, url }
  /** 'all', or page ranges like "2-5, 8" (positions in the edited document). */
  pages: 'all',
};

/** Auto text size fills this fraction of the page (by the rotated text's bounds). */
const AUTO_FILL = 0.8;
export const MIN_WATERMARK_SIZE = 6;
export const MAX_WATERMARK_SIZE = 400;

const rad = (deg) => (deg * Math.PI) / 180;

/** Glyph box metrics for a standard font, per point of size. */
export function glyphMetrics(font) {
  const f = STANDARD_FONTS[font] ?? STANDARD_FONTS.Helvetica;
  return {
    height: (f.ascender - f.descender) / 1000,
    /** Baseline → vertical centre of the glyph box. */
    centre: (f.ascender + f.descender) / 2000,
  };
}

/** Page size as shown at `rotation` (quarter turns swap the sides). */
export function shownSize(pageBox, rotation) {
  return normalizeQuarterTurn(rotation) % 180 === 0
    ? { width: pageBox.width, height: pageBox.height }
    : { width: pageBox.height, height: pageBox.width };
}

/**
 * Largest font size at which text `unitWidth` points wide per point of size
 * (i.e. width at size 1), rotated by `angle`, fits within `fill` of the
 * shown page.
 */
export function autoFontSize(unitWidth, font, shown, angle, fill = AUTO_FILL) {
  const { height } = glyphMetrics(font);
  const c = Math.abs(Math.cos(rad(angle)));
  const s = Math.abs(Math.sin(rad(angle)));
  const size = Math.min(
    (fill * shown.width) / (unitWidth * c + height * s),
    (fill * shown.height) / (unitWidth * s + height * c)
  );
  return Math.max(MIN_WATERMARK_SIZE, Math.min(MAX_WATERMARK_SIZE, size));
}

/** Map a shown-space point (y up) to PDF space for a page box and rotation. */
function shownToPdf(point, pageBox, rotation, shown) {
  // coords.js works top-left/y-down in "viewport" units; at scale 1 those
  // are points, so flip y and convert.
  return viewportToPdfPoint({ x: point.x, y: shown.height - point.y }, { pageBox, scale: 1, rotation });
}

/**
 * Where to start drawing so that a w × h box, whose own origin is offset by
 * (ox, oy) from its centre, ends up centred on the shown page and turned by
 * `angle`: rotate the offset, add it to the page centre.
 */
function centredStart(shown, angle, ox, oy) {
  const a = rad(angle);
  return {
    x: shown.width / 2 + ox * Math.cos(a) - oy * Math.sin(a),
    y: shown.height / 2 + ox * Math.sin(a) + oy * Math.cos(a),
  };
}

/**
 * drawText options (PDF space) for a text watermark on one page.
 * `unitWidth` = text width at size 1 (exact font metrics at export).
 * Returns { text, x, y, size, rotate } — `rotate` in degrees, CCW.
 */
export function textWatermarkOp(config, { pageBox, rotation }, unitWidth) {
  const { text, font, angle } = { ...DEFAULT_WATERMARK, ...config };
  const shown = shownSize(pageBox, rotation);
  const size =
    config.fontSize === 'auto' || config.fontSize == null
      ? autoFontSize(unitWidth, font, shown, angle)
      : Number(config.fontSize);
  const width = unitWidth * size;
  // Baseline start sits half the width left of, and the glyph centre below, the middle.
  const start = centredStart(shown, angle, -width / 2, -glyphMetrics(font).centre * size);
  return {
    text,
    size,
    width,
    ...shownToPdf(start, pageBox, rotation, shown),
    rotate: angle + normalizeQuarterTurn(rotation),
  };
}

/**
 * drawImage options (PDF space) for an image watermark: `imageScale` of the
 * shown page width (aspect kept, and never taller than the page), centred,
 * turned by `angle`.
 */
export function imageWatermarkOp(config, { pageBox, rotation }) {
  const { image, imageScale, angle } = { ...DEFAULT_WATERMARK, ...config };
  const shown = shownSize(pageBox, rotation);
  let width = shown.width * imageScale;
  let height = (width * image.height) / image.width;
  if (height > shown.height) {
    width *= shown.height / height;
    height = shown.height;
  }
  const start = centredStart(shown, angle, -width / 2, -height / 2);
  return {
    width,
    height,
    ...shownToPdf(start, pageBox, rotation, shown),
    rotate: angle + normalizeQuarterTurn(rotation),
  };
}

/**
 * Which of `count` pages get the watermark, for a pages setting of 'all' or
 * ranges like "2-5, 8" (positions in the edited document). Numbers past the
 * end are ignored rather than failing, so deleting pages never breaks it.
 */
export function watermarkApplies(pages, count) {
  if (!pages || pages === 'all') return Array.from({ length: count }, () => true);
  // Treat any number past the end as "one past the last page", so ranges
  // like "3-100000" or a stray "9" are tolerated, and the work never exceeds
  // the document's length (open ranges like "2-" end at the last page).
  const bound = count + 1;
  const clamped = String(pages).replace(/\d+/g, (d) => String(Math.min(Number(d), bound)));
  const result = parsePageRanges(clamped, bound);
  const chosen = new Set(result.pages ?? []);
  return Array.from({ length: count }, (_, i) => chosen.has(i + 1));
}

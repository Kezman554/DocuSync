/**
 * Redaction: boxes that REMOVE content, not cover it. Pure helpers.
 *
 * A redaction box is an annotation `{ id, type: 'redaction', rect }`, with
 * `rect` in the source page's PDF space like every other annotation
 * (lib/annotations.js). pdf-lib can't edit content streams, so on export any
 * page carrying a box is flattened (lib/flatten.js): rendered to pixels with
 * everything DocuSync draws on it, the boxes painted solid black on the
 * canvas, and the output page rebuilt from that image alone. None of the
 * original page's objects — text, fonts, form fields, links, comments —
 * reach the exported file.
 */
import { getAnnotations } from './annotations.js';
import { pdfToViewportRect } from './coords.js';

/**
 * Flattening resolution. 150 dpi keeps 8–10 pt body text readable on
 * screen and in print while a typical text page stays around 100–300 KB;
 * 300 dpi would roughly quadruple that.
 */
export const REDACTION_DPI = 150;

export const isRedaction = (annotation) => annotation.type === 'redaction';

/** The page's redaction boxes (PDF rects), in drawing order. */
export const redactionRects = (page) =>
  getAnnotations(page).filter(isRedaction).map((a) => a.rect);

export const isRedacted = (page) => getAnnotations(page).some(isRedaction);

/** 1-based positions of the pages that carry at least one box. */
export const redactedPositions = (pages) =>
  pages.flatMap((page, i) => (isRedacted(page) ? [i + 1] : []));

/**
 * A redaction box in canvas pixels for a page rendered UNROTATED at `scale`
 * (px per pt) from `pageBox`, snapped OUTWARD to whole pixels and clipped
 * to the canvas. Snapping outward means no edge pixel is left half-covered
 * — an anti-aliased edge would blend in a sliver of what's underneath.
 * Null if the box misses the canvas entirely.
 */
export function redactionPixelRect(rect, pageBox, scale, canvas) {
  const px = pdfToViewportRect(rect, { pageBox, scale, rotation: 0 });
  const left = Math.max(0, Math.floor(px.x));
  const top = Math.max(0, Math.floor(px.y));
  const right = Math.min(canvas.width, Math.ceil(px.x + px.width));
  const bottom = Math.min(canvas.height, Math.ceil(px.y + px.height));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * What to tell the user before exporting `count` redacted pages: they become
 * images, and the source's document info isn't carried over.
 */
export function redactionWarning(count) {
  const pages = count === 1 ? '1 redacted page' : `${count} redacted pages`;
  const them = count === 1 ? 'It becomes an image' : 'They become images';
  return (
    `This export includes ${pages}. ${them}: text on ${count === 1 ? 'it' : 'them'} ` +
    'will no longer be selectable or searchable, and anything under a redaction box ' +
    'is removed for good. The original document’s title, author, subject and ' +
    'keywords won’t be copied, since they can repeat what was redacted.'
  );
}

/**
 * PDF → images: formats, resolutions, sizes and file names. Pure.
 * Rendering itself is browser-side (renderPages.js).
 */
import { formatPageRanges } from './pageRanges.js';

export const IMAGE_FORMATS = {
  png: { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png', quality: undefined },
  jpeg: { id: 'jpeg', label: 'JPG', mime: 'image/jpeg', ext: 'jpg', quality: 0.92 },
};

/** Resolutions offered, in dots per inch. 72 dpi = 1px per PDF point. */
export const RESOLUTIONS = [
  { dpi: 72, label: 'Screen (72 dpi)' },
  { dpi: 150, label: 'Standard (150 dpi)' },
  { dpi: 300, label: 'Print (300 dpi)' },
];
export const DEFAULT_DPI = 150;

/**
 * Browsers cap canvas size (commonly ~16k px a side / ~268M px); stay well
 * inside so huge pages at high DPI degrade to a lower scale instead of failing.
 */
export const MAX_SIDE_PX = 10000;
export const MAX_AREA_PX = 64e6;

/**
 * pdf.js render scale for `dpi`, reduced if the page (in points, as shown,
 * i.e. after rotation) would exceed the canvas limits.
 */
export function renderScale(pageWidthPt, pageHeightPt, dpi) {
  let scale = dpi / 72;
  const side = Math.max(pageWidthPt, pageHeightPt) * scale;
  if (side > MAX_SIDE_PX) scale *= MAX_SIDE_PX / side;
  const area = pageWidthPt * pageHeightPt * scale * scale;
  if (area > MAX_AREA_PX) scale *= Math.sqrt(MAX_AREA_PX / area);
  return scale;
}

/** Pixel size of a page rendered at `scale` (pdf.js floors the viewport). */
export const pixelSize = (pageWidthPt, pageHeightPt, scale) => ({
  width: Math.floor(pageWidthPt * scale),
  height: Math.floor(pageHeightPt * scale),
});

const baseName = (name) => (name || 'document').replace(/\.pdf$/i, '');

/**
 * Image file name for page `position` (1-based, as numbered in the sidebar).
 * Numbers are zero-padded to the document's page count so files sort right.
 */
export function imageFileName(docName, position, pageCount, format) {
  const digits = String(Math.max(pageCount, 1)).length;
  const n = String(position).padStart(Math.max(2, digits), '0');
  return `${baseName(docName)}-page-${n}.${IMAGE_FORMATS[format].ext}`;
}

/** ZIP name: "report-pages-1-3_5-png.zip" (or "report-images-png.zip" if long). */
export function zipFileName(docName, positions, format) {
  const ranges = formatPageRanges(positions).replace(/, /g, '_');
  const ext = IMAGE_FORMATS[format].ext;
  return ranges && ranges.length <= 40
    ? `${baseName(docName)}-pages-${ranges}-${ext}.zip`
    : `${baseName(docName)}-images-${ext}.zip`;
}

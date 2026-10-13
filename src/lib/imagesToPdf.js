/**
 * Images → PDF: one image per page, sized sensibly. Pure apart from the
 * lazily-imported pdf-lib.
 *
 * Input images are PNG or JPEG bytes (other formats are converted to PNG in
 * the browser first — see imageFiles.js), embedded as-is so JPEGs aren't
 * recompressed. JPEG EXIF orientation (how phones store sideways photos) is
 * honoured by drawing the image with the matching rotation/mirror matrix,
 * since PDF viewers ignore EXIF.
 */

/** Page size choices, in points. `fit` makes each page the image's own size. */
export const PAGE_SIZES = {
  letter: { label: 'Letter', width: 612, height: 792 },
  a4: { label: 'A4', width: 595.28, height: 841.89 },
  fit: { label: 'Fit to image' },
};

export const MARGINS = [
  { id: 'none', label: 'None', points: 0 },
  { id: 'small', label: 'Small (¼ in)', points: 18 },
  { id: 'normal', label: 'Normal (½ in)', points: 36 },
];
export const DEFAULT_MARGIN = 'normal';

/** Images have no reliable physical size; treat pixels as CSS pixels (96 dpi). */
export const PX_TO_PT = 72 / 96;
/** PDF's practical page size limit (200 in). */
const MAX_PAGE_PT = 14400;

/** Letter where it's the paper standard; A4 everywhere else. */
export function defaultPageSize(locale = '') {
  return /-(US|CA|MX|PH)\b/i.test(locale) ? 'letter' : 'a4';
}

// ---------------------------------------------------------------------------
// EXIF orientation
// ---------------------------------------------------------------------------

/**
 * EXIF orientation (1–8) of JPEG bytes; 1 (upright) if absent or unreadable.
 * Reads only the APP1 "Exif" segment's first IFD.
 */
export function exifOrientation(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda || marker === 0xd9) break; // image data / end: no EXIF
    const length = (b[i + 2] << 8) | b[i + 3];
    if (
      marker === 0xe1 &&
      b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66 && // "Exif"
      b[i + 8] === 0 && b[i + 9] === 0
    ) {
      return readTiffOrientation(b, i + 10, i + 2 + length);
    }
    i += 2 + length;
  }
  return 1;
}

function readTiffOrientation(b, tiff, end) {
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49; // "II"
  const big = b[tiff] === 0x4d && b[tiff + 1] === 0x4d; // "MM"
  if (!little && !big) return 1;
  const u16 = (p) => (little ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
  const u32 = (p) =>
    little
      ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0
      : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  if (u16(tiff + 2) !== 42) return 1;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let k = 0; k < count; k += 1) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Displayed size of a stored `width` × `height` image (5–8 swap sides). */
export const orientedSize = (width, height, orientation = 1) =>
  orientation >= 5 ? { width: height, height: width } : { width, height };

/**
 * PDF matrix [a b c d e f] that draws the STORED image (unit square, top row
 * at y = 1) so it appears correctly oriented filling the rect x, y, w × h.
 * Derived from where each stored corner must land for the EXIF orientation.
 */
export function orientationMatrix(orientation, x, y, w, h) {
  switch (orientation) {
    case 2: return [-w, 0, 0, h, x + w, y]; // mirrored
    case 3: return [-w, 0, 0, -h, x + w, y + h]; // rotated 180°
    case 4: return [w, 0, 0, -h, x, y + h]; // flipped vertically
    case 5: return [0, -h, -w, 0, x + w, y + h]; // transposed
    case 6: return [0, -h, w, 0, x, y + h]; // rotated 90° clockwise
    case 7: return [0, h, w, 0, x, y]; // transversed
    case 8: return [0, h, -w, 0, x + w, y]; // rotated 90° anticlockwise
    default: return [w, 0, 0, h, x, y]; // upright
  }
}

// ---------------------------------------------------------------------------
// Page layout
// ---------------------------------------------------------------------------

/**
 * Page size and image rect (pt) for an image displayed at `width` × `height`
 * px. Paper sizes turn to match the image (landscape image → landscape page);
 * the image is fitted inside the margins and centred, never enlarged beyond
 * its natural size (so small images don't go blurry). `fit` makes the page
 * exactly the image's natural size.
 */
export function layoutImagePage({ width, height }, { pageSize = 'a4', margin = 36 } = {}) {
  let w = width * PX_TO_PT;
  let h = height * PX_TO_PT;

  if (pageSize === 'fit' || !PAGE_SIZES[pageSize]?.width) {
    const shrink = Math.min(1, MAX_PAGE_PT / w, MAX_PAGE_PT / h);
    w *= shrink;
    h *= shrink;
    return { pageWidth: w, pageHeight: h, x: 0, y: 0, width: w, height: h };
  }

  const paper = PAGE_SIZES[pageSize];
  const landscape = width > height;
  const pageWidth = landscape ? Math.max(paper.width, paper.height) : Math.min(paper.width, paper.height);
  const pageHeight = landscape ? Math.min(paper.width, paper.height) : Math.max(paper.width, paper.height);
  const scale = Math.min(1, (pageWidth - 2 * margin) / w, (pageHeight - 2 * margin) / h);
  w *= scale;
  h *= scale;
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - w) / 2,
    y: (pageHeight - h) / 2,
    width: w,
    height: h,
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * @param {{ bytes: Uint8Array, mime: 'image/png'|'image/jpeg',
 *           width: number, height: number, orientation?: number }[]} images
 *   stored pixel sizes; orientation is the EXIF value (JPEG), default 1
 * @param {{ pageSize?: string, margin?: number, title?: string }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function buildImagesPdf(images, { pageSize = 'a4', margin = 36, title = 'Images' } = {}) {
  if (!images.length) throw new Error('Add at least one image');
  const {
    PDFDocument,
    pushGraphicsState,
    popGraphicsState,
    concatTransformationMatrix,
    drawObject,
  } = await import('pdf-lib');

  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('DocuSync (pdf-lib)');
  doc.setCreator('DocuSync');

  for (const image of images) {
    const embedded =
      image.mime === 'image/png' ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
    const orientation = image.orientation ?? 1;
    const shown = orientedSize(image.width, image.height, orientation);
    const box = layoutImagePage(shown, { pageSize, margin });
    const page = doc.addPage([box.pageWidth, box.pageHeight]);
    const name = page.node.newXObject('Image', embedded.ref);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...orientationMatrix(orientation, box.x, box.y, box.width, box.height)),
      drawObject(name),
      popGraphicsState()
    );
  }
  return doc.save();
}

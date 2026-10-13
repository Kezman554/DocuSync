/**
 * Bake the in-memory page model into a new PDF with pdf-lib.
 *
 * Pages are copied as PDF objects (content streams, fonts, resources), never
 * rasterised, so text stays selectable and vector content stays sharp. The
 * page order and each page's /Rotate change, and annotations are drawn on top
 * (text as real, selectable text via drawText; images via drawImage).
 *
 * pdf-lib is imported lazily so it's only loaded when the user exports.
 */
import { effectiveRotation } from './pageModel.js';
import { formatPageRanges } from './pageRanges.js';
import { getAnnotations } from './annotations.js';
import { hexToRgb, textDrawOps } from './textLayout.js';
import { anchorOf, ownSize } from './ownFrame.js';
import { pageNumberAnnotation } from './pageNumbering.js';
import { imageWatermarkOp, textWatermarkOp } from './watermark.js';

/** Thrown for PDFs we can't rewrite (e.g. encrypted); `message` is user-facing. */
export class ExportError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ExportError';
  }
}

/**
 * @param {Record<string, { name: string, bytes: ArrayBuffer|Uint8Array }>} sources
 *   original, unmodified files keyed by sourceId (only those `pages` use are read)
 * @param {{ sourceId: string, sourcePage: number, rotation: number }[]} pages
 *   the page model (or a slice of it), in output order
 * @param {{ pageNumbers?: { labels: (string|null)[], style: object },
 *           watermark?: { config: object, applies: boolean[] } }} [options]
 *   page numbering: a label per output page (null = none) and its style
 *   (lib/pageNumbering.js); watermark: its settings (lib/watermark.js) and
 *   which output pages get it
 * @returns {Promise<Uint8Array>} the new PDF's bytes
 */
export async function buildPdf(sources, pages, { pageNumbers, watermark } = {}) {
  if (!pages.length) throw new ExportError('There are no pages to export.');

  const pdfLib = await import('pdf-lib');
  const { PDFDocument, degrees } = pdfLib;

  // Group output slots by source, in order of first appearance.
  const slotsBySource = new Map();
  pages.forEach((entry, slot) => {
    if (!slotsBySource.has(entry.sourceId)) slotsBySource.set(entry.sourceId, []);
    slotsBySource.get(entry.sourceId).push(slot);
  });
  const multiple = slotsBySource.size > 1;

  const output = await PDFDocument.create();
  const placed = new Array(pages.length);

  for (const [sourceId, slots] of slotsBySource) {
    const input = sources[sourceId];
    const label = multiple && input?.name ? `“${input.name}”` : 'the original PDF';
    if (!input) throw new ExportError(`Couldn’t find ${label} for export.`);

    const source = await loadSource(PDFDocument, input.bytes, label);

    // pdf-lib can disagree with pdf.js about a damaged file's page count —
    // check every page we need actually exists.
    const available = source.getPageCount();
    if (slots.some((i) => pages[i].sourcePage < 1 || pages[i].sourcePage > available)) {
      throw new ExportError(`Couldn’t read all pages of ${label} for export.`);
    }

    // Metadata comes from whichever document supplies the first page.
    if (placed.every((p) => p === undefined)) copyMetadata(source, output);

    // copyPages also flattens inherited attributes (MediaBox, Resources,
    // Rotate) onto each copied page, so pages stand alone in the new tree.
    // One call per source lets pages share copied fonts/images.
    const copied = await output.copyPages(
      source,
      slots.map((i) => pages[i].sourcePage - 1)
    );
    copied.forEach((page, k) => {
      placed[slots[k]] = page;
    });
  }

  const embed = { font: fontEmbedder(output, pdfLib), image: imageEmbedder(output) };
  for (const [i, page] of placed.entries()) {
    const intrinsic = page.getRotation().angle;
    page.setRotation(degrees(effectiveRotation(intrinsic, pages[i].rotation)));
    output.addPage(page);
    await drawAnnotations(page, getAnnotations(pages[i]), embed, pdfLib);
    if (watermark?.applies?.[i]) await drawWatermark(page, watermark.config, embed, pdfLib);

    const label = pageNumbers?.labels?.[i];
    if (label) {
      // Measure with the real font so centred/right-aligned numbers are exact.
      const font = await embed.font(pageNumbers.style.font);
      const width = font.widthOfTextAtSize(
        encodable(label, new Set(font.getCharacterSet())),
        pageNumbers.style.fontSize
      );
      const number = pageNumberAnnotation(
        label,
        { pageBox: page.getCropBox(), rotation: page.getRotation().angle },
        pageNumbers.style,
        width
      );
      await drawAnnotations(page, [number], embed, pdfLib);
    }
  }

  return output.save();
}

/** Embed each standard font at most once per output document. */
function fontEmbedder(output, { StandardFonts }) {
  const cache = new Map();
  return (name) => {
    const key = StandardFonts[name] ? name : 'Helvetica';
    if (!cache.has(key)) cache.set(key, output.embedFont(StandardFonts[key]));
    return cache.get(key);
  };
}

/** Embed each image (by id) at most once, however many times it's placed. */
function imageEmbedder(output) {
  const cache = new Map();
  return (image) => {
    if (!cache.has(image.id)) {
      const embed = image.mime === 'image/png' ? output.embedPng : output.embedJpg;
      cache.set(
        image.id,
        embed.call(output, image.bytes).catch((err) => {
          throw new ExportError('One of the placed images couldn’t be embedded.', {
            cause: err,
          });
        })
      );
    }
    return cache.get(image.id);
  };
}

/**
 * Draw annotations onto a copied page. Annotation coordinates are in the
 * source page's PDF space, which the copied page keeps. Markers are an
 * on-screen test type and aren't exported.
 */
async function drawAnnotations(page, annotations, embed, { degrees, rgb }) {
  for (const annotation of annotations) {
    if (annotation.type === 'image') {
      // Same own-frame placement as text: bottom-left anchor + rotation.
      const image = await embed.image(annotation.image);
      const { x, y } = anchorOf(annotation.rect, annotation.rotate);
      const { width, height } = ownSize(annotation.rect, annotation.rotate);
      page.drawImage(image, { x, y, width, height, rotate: degrees(annotation.rotate) });
      continue;
    }
    if (annotation.type !== 'text' || !annotation.text?.trim()) continue;
    const font = await embed.font(annotation.font);
    const { r, g, b } = hexToRgb(annotation.color);
    const supported = new Set(font.getCharacterSet());
    for (const op of textDrawOps(annotation)) {
      page.drawText(encodable(op.text, supported), {
        x: op.x,
        y: op.y,
        size: annotation.fontSize,
        font,
        color: rgb(r, g, b),
        rotate: degrees(annotation.rotate),
      });
    }
  }
}

/**
 * Draw a watermark centred on the page as displayed, turned by its angle,
 * at its opacity — over the page content and annotations.
 */
async function drawWatermark(page, config, embed, { degrees, rgb }) {
  const geometry = { pageBox: page.getCropBox(), rotation: page.getRotation().angle };
  if (config.type === 'image') {
    if (!config.image) return;
    const image = await embed.image(config.image);
    const op = imageWatermarkOp(config, geometry);
    page.drawImage(image, {
      x: op.x,
      y: op.y,
      width: op.width,
      height: op.height,
      rotate: degrees(op.rotate),
      opacity: config.opacity,
    });
    return;
  }
  if (!config.text?.trim()) return;
  const font = await embed.font(config.font);
  const text = encodable(config.text, new Set(font.getCharacterSet()));
  const op = textWatermarkOp({ ...config, text }, geometry, font.widthOfTextAtSize(text, 1));
  const { r, g, b } = hexToRgb(config.color);
  page.drawText(text, {
    x: op.x,
    y: op.y,
    size: op.size,
    font,
    color: rgb(r, g, b),
    rotate: degrees(op.rotate),
    opacity: config.opacity,
  });
}

/**
 * Standard fonts only cover WinAnsi; replace anything else (emoji, CJK…)
 * with "?" rather than failing the whole export.
 */
function encodable(text, supported) {
  return Array.from(text, (ch) => (supported.has(ch.codePointAt(0)) ? ch : '?')).join('');
}

async function loadSource(PDFDocument, bytes, label) {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    // Lenient parsing can "succeed" on junk with no page tree; this throws then.
    doc.getPageCount();
    return doc;
  } catch (err) {
    if (/encrypted/i.test(err?.message ?? '')) {
      throw new ExportError(
        `${capitalise(label)} is password-protected or encrypted, so it can’t be re-saved.`,
        { cause: err }
      );
    }
    throw new ExportError(`Couldn’t read ${label} for export.`, { cause: err });
  }
}

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function copyMetadata(source, output) {
  const title = source.getTitle();
  const author = source.getAuthor();
  const subject = source.getSubject();
  const keywords = source.getKeywords();
  const creator = source.getCreator();
  if (title) output.setTitle(title);
  if (author) output.setAuthor(author);
  if (subject) output.setSubject(subject);
  if (keywords) output.setKeywords(keywords.split(/\s*,\s*|\s+/).filter(Boolean));
  if (creator) output.setCreator(creator);
  output.setProducer('DocuSync (pdf-lib)');
}

/**
 * "report.pdf" + [2, 3, 4, 7] → "report-pages-2-4_7.pdf". Falls back to
 * "report-extract.pdf" when the range list would make an unwieldy name.
 */
export function extractFileName(name, positions) {
  const base = (name || 'document').replace(/\.pdf$/i, '');
  const ranges = formatPageRanges(positions).replace(/, /g, '_');
  if (!ranges || ranges.length > 40) return `${base}-extract.pdf`;
  const label = positions.length === 1 ? 'page' : 'pages';
  return `${base}-${label}-${ranges}.pdf`;
}

/** "report.pdf" → "report-edited.pdf" (or "report-merged.pdf"). */
export function exportFileName(name, { merged = false } = {}) {
  const base = (name || 'document').replace(/\.pdf$/i, '');
  return `${base}-${merged ? 'merged' : 'edited'}.pdf`;
}

/**
 * Bake the in-memory page model into a new PDF with pdf-lib.
 *
 * Pages are copied as PDF objects (content streams, fonts, resources), never
 * rasterised, so text stays selectable and vector content stays sharp. Only
 * the page order and each page's /Rotate change.
 *
 * pdf-lib is imported lazily so it's only loaded when the user exports.
 */
import { effectiveRotation } from './pageModel.js';
import { formatPageRanges } from './pageRanges.js';

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
 * @returns {Promise<Uint8Array>} the new PDF's bytes
 */
export async function buildPdf(sources, pages) {
  if (!pages.length) throw new ExportError('There are no pages to export.');

  const { PDFDocument, degrees } = await import('pdf-lib');

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

  placed.forEach((page, i) => {
    const intrinsic = page.getRotation().angle;
    page.setRotation(degrees(effectiveRotation(intrinsic, pages[i].rotation)));
    output.addPage(page);
  });

  return output.save();
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

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
 * @param {ArrayBuffer|Uint8Array} sourceBytes  the original, unmodified file
 * @param {{ sourcePage: number, rotation: number }[]} pages  the page model
 * @returns {Promise<Uint8Array>} the new PDF's bytes
 */
export async function buildPdf(sourceBytes, pages) {
  if (!pages.length) throw new ExportError('There are no pages to export.');

  const { PDFDocument, degrees } = await import('pdf-lib');

  let source;
  let available;
  try {
    source = await PDFDocument.load(sourceBytes, { updateMetadata: false });
    // Lenient parsing can "succeed" on junk with no page tree; this throws then.
    available = source.getPageCount();
  } catch (err) {
    if (/encrypted/i.test(err?.message ?? '')) {
      throw new ExportError(
        'This PDF is password-protected or encrypted, so it can’t be re-saved.',
        { cause: err }
      );
    }
    throw new ExportError('Couldn’t read the original PDF for export.', {
      cause: err,
    });
  }

  // pdf-lib can disagree with pdf.js about a damaged file's page count —
  // check every page we need actually exists.
  if (pages.some((p) => p.sourcePage < 1 || p.sourcePage > available)) {
    throw new ExportError(
      'Couldn’t read all pages of the original PDF for export.'
    );
  }

  const output = await PDFDocument.create();
  copyMetadata(source, output);

  // copyPages also flattens inherited attributes (MediaBox, Resources,
  // Rotate) onto each copied page, so pages stand alone in the new tree.
  const copied = await output.copyPages(
    source,
    pages.map((p) => p.sourcePage - 1)
  );

  copied.forEach((page, i) => {
    const intrinsic = page.getRotation().angle;
    page.setRotation(degrees(effectiveRotation(intrinsic, pages[i].rotation)));
    output.addPage(page);
  });

  return output.save();
}

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

/** "report.pdf" → "report-edited.pdf". */
export function exportFileName(name) {
  const base = (name || 'document').replace(/\.pdf$/i, '');
  return `${base}-edited.pdf`;
}

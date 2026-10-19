/**
 * Bake the in-memory page model into a new PDF with pdf-lib.
 *
 * Pages are copied as PDF objects (content streams, fonts, resources), never
 * rasterised, so text stays selectable and vector content stays sharp. The
 * page order and each page's /Rotate change, and annotations are drawn on top
 * (text as real, selectable text via drawText; images via drawImage).
 *
 * The one exception is redaction (lib/redaction.js): a page carrying a
 * redaction box is rebuilt from a flattened image, because pdf-lib can't
 * remove the content under the box from a content stream.
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
import { isRedacted, redactionRects } from './redaction.js';

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
 *           watermark?: { config: object, applies: boolean[] },
 *           flatten?: (pdfBytes: Uint8Array, jobs: { rects: object[] }[]) =>
 *             Promise<{ bytes: Uint8Array, mime: string, width: number, height: number }[]> }} [options]
 *   page numbering: a label per output page (null = none) and its style
 *   (lib/pageNumbering.js); watermark: its settings (lib/watermark.js) and
 *   which output pages get it; flatten: renders pages that carry redaction
 *   boxes (lib/flatten.js) — required if any page has one
 * @returns {Promise<Uint8Array>} the new PDF's bytes
 */
export async function buildPdf(sources, pages, { pageNumbers, watermark, flatten } = {}) {
  if (!pages.length) throw new ExportError('There are no pages to export.');

  // Redacted pages are flattened. Without a way to do that, refuse rather
  // than export them with their content intact.
  const redacted = pages.map(isRedacted);
  const anyRedacted = redacted.some(Boolean);
  if (anyRedacted && !flatten) {
    throw new ExportError('Redacted pages can’t be exported here, so nothing was exported.');
  }

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
  // Redacted pages are copied into this throwaway document instead; it's
  // rendered to pixels and nothing in it is ever copied into `output`.
  const staging = anyRedacted ? await PDFDocument.create() : null;
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

    // Metadata comes from whichever document supplies the first page — unless
    // anything is redacted: a title or keywords can repeat what was removed.
    if (!anyRedacted && placed.every((p) => p === undefined)) copyMetadata(source, output);

    // Copying also flattens inherited attributes (MediaBox, Resources,
    // Rotate) onto each copied page, so pages stand alone in the new tree.
    // One call per source (and target) lets pages share copied fonts/images.
    const place = (wanted, copied) =>
      copied.forEach((page, k) => {
        placed[wanted[k]] = page;
      });
    const toStaging = slots.filter((i) => redacted[i]);
    const toOutput = slots.filter((i) => !redacted[i]);
    const kept = toOutput.map((i) => pages[i].sourcePage - 1);

    // Staging first: it needs the redacted pages whole.
    if (toStaging.length) {
      place(
        toStaging,
        await staging.copyPages(source, toStaging.map((i) => pages[i].sourcePage - 1))
      );
    }
    // Then cut off every page that isn't exported as-is — redacted, deleted
    // or left out of an extract — before anything is copied into the export.
    const keptSet = new Set(kept);
    const excluded = [...Array(available).keys()].filter((n) => !keptSet.has(n));
    const severed = excluded.length ? isolateExcludedPages(source, excluded, kept, pdfLib) : [];
    if (toOutput.length) place(toOutput, await copyPagesLinked(output, source, kept, severed, pdfLib));
  }
  output.setProducer('DocuSync (pdf-lib)');

  // Redacted pages: compose them in staging exactly as they'd be exported,
  // then render, black out the boxes, and keep only the pixels.
  const flatImages = new Map();
  if (staging) {
    const stagingEmbed = { font: fontEmbedder(staging, pdfLib), image: imageEmbedder(staging) };
    const slots = [...pages.keys()].filter((i) => redacted[i]);
    for (const i of slots) {
      await composePage(staging, placed[i], i, stagingEmbed);
    }
    let images;
    try {
      images = await flatten(
        await staging.save(),
        slots.map((i) => ({ rects: redactionRects(pages[i]) }))
      );
    } catch (err) {
      throw new ExportError('Couldn’t flatten the redacted pages, so nothing was exported.', {
        cause: err,
      });
    }
    if (images?.length !== slots.length) {
      throw new ExportError('Couldn’t flatten the redacted pages, so nothing was exported.');
    }
    slots.forEach((i, k) => flatImages.set(i, images[k]));
  }

  const embed = { font: fontEmbedder(output, pdfLib), image: imageEmbedder(output) };
  for (const i of pages.keys()) {
    if (redacted[i]) {
      // A fresh page at the original visible size and rotation, holding
      // nothing but the flattened image.
      const flat = flatImages.get(i);
      const image = await (flat.mime === 'image/png'
        ? output.embedPng(flat.bytes)
        : output.embedJpg(flat.bytes));
      const page = output.addPage([flat.width, flat.height]);
      page.drawImage(image, { x: 0, y: 0, width: flat.width, height: flat.height });
      page.setRotation(placed[i].getRotation());
    } else {
      await composePage(output, placed[i], i, embed);
    }
  }

  return output.save();

  /** Rotate a copied page as edited, add it to `doc`, and draw DocuSync's marks on it. */
  async function composePage(doc, page, i, embed) {
    const intrinsic = page.getRotation().angle;
    page.setRotation(degrees(effectiveRotation(intrinsic, pages[i].rotation)));
    doc.addPage(page);
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
}

/**
 * Cut every path from the pages about to be exported to the content of the
 * excluded ones — redacted, deleted, or left out of an extract — in the
 * in-memory `source` (after any redacted pages went to staging). Copying
 * follows references, so a link's /Dest, a reply's /IRT or a widget's
 * /Parent → /Kids would otherwise copy an excluded page, or its
 * annotations, into the export.
 *
 * - Excluded pages and their annotations are emptied, so whatever still
 *   points at them finds nothing.
 * - A form field with a widget on an excluded page loses its widgets on the
 *   kept pages too: the value is shared between them, so it would carry
 *   what was on the excluded page. Other fields are untouched.
 *
 * Returns the references to excluded pages and their annotations, for
 * copyPagesLinked to map to nothing.
 */
function isolateExcludedPages(source, excludedIndices, keptIndices, { PDFName, PDFRef }) {
  const { context } = source;
  const all = source.getPages();
  const excludedPages = excludedIndices.map((n) => all[n]);
  const excludedNodes = new Set(excludedPages.map((p) => p.node));
  const keptPages = keptIndices.map((n) => all[n]).filter((p) => !excludedNodes.has(p.node));
  const Subtype = PDFName.of('Subtype');
  const isWidget = (dict) => dict?.get(Subtype) === PDFName.of('Widget');
  const annotationsOf = (node) => node.Annots()?.asArray() ?? [];

  // The top of a widget's /Parent chain is its field (a widget with no
  // parent is its own field).
  const fieldOf = (entry) => {
    let field = entry;
    for (let depth = 0; depth < 32; depth += 1) {
      const parent = context.lookup(field)?.get?.(PDFName.of('Parent'));
      if (!(parent instanceof PDFRef)) break;
      field = parent;
    }
    return field;
  };

  const excludedFields = new Set();
  for (const node of excludedNodes) {
    for (const entry of annotationsOf(node)) {
      const dict = context.lookup(entry);
      if (isWidget(dict)) excludedFields.add(fieldOf(entry));
    }
  }

  if (excludedFields.size) {
    for (const page of keptPages) {
      const entries = annotationsOf(page.node);
      const kept = entries.filter(
        (entry) => !(isWidget(context.lookup(entry)) && excludedFields.has(fieldOf(entry)))
      );
      if (kept.length !== entries.length) page.node.set(PDFName.of('Annots'), context.obj(kept));
    }
  }

  const severed = [];
  const Type = PDFName.of('Type');
  const empty = (dict, keep) => {
    for (const key of dict.keys()) if (!keep.includes(key)) dict.delete(key);
  };
  for (const page of excludedPages) {
    severed.push(page.ref);
    for (const entry of annotationsOf(page.node)) {
      if (entry instanceof PDFRef) severed.push(entry);
      const dict = context.lookup(entry);
      if (dict?.keys) empty(dict, [Type, Subtype]);
    }
    empty(page.node, [Type]);
  }
  return severed;
}

/**
 * pdf-lib's copyPages, except that references between the copied pages
 * land on the copies in the page tree, and references in `severed` (left-out
 * pages and their annotations) land on null. copyPages copies a page that's
 * referenced (by a link, or an annotation's /P) a second time as a stray
 * page outside the tree — so a link to a kept page went nowhere, and one to
 * a left-out page brought that page's content along.
 */
async function copyPagesLinked(target, source, indices, severed, { PDFObjectCopier, PDFNull, PDFPage }) {
  await source.flush();
  const all = source.getPages();
  const copier = PDFObjectCopier.for(source.context, target.context);
  for (const ref of severed) copier.traversedObjects.set(ref, PDFNull);
  // Claim each kept page's new reference before copying anything, so any
  // reference to it found along the way resolves to the real copy.
  const refs = indices.map((n) => {
    const ref = target.context.nextRef();
    copier.traversedObjects.set(all[n].ref, ref);
    return ref;
  });
  return indices.map((n, k) => {
    const node = copier.copy(all[n].node);
    target.context.assign(refs[k], node);
    return PDFPage.of(node, refs[k], target);
  });
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
 * on-screen test type and aren't exported; redaction boxes are applied by
 * flattening instead.
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

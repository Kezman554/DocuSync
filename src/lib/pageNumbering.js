/**
 * Page numbering: labels and placement. Pure.
 *
 * Numbering is a document-level setting; each page's number comes from its
 * position in the edited document. A number is laid out like a text
 * annotation (lib/textLayout.js) so the preview and the export (drawText)
 * place its baseline identically, and it's positioned relative to the page
 * AS DISPLAYED — so on a rotated page it still sits at the visual bottom (or
 * top) and reads upright.
 */
import { viewportToPdfPoint } from './coords.js';
import { rectFromTopLeft } from './ownFrame.js';
import { textLayout } from './textLayout.js';

export const NUMBER_FORMATS = [
  { id: 'n', template: '{n}' },
  { id: 'page-n', template: 'Page {n}' },
  { id: 'page-n-of-total', template: 'Page {n} of {total}' },
  { id: 'n-slash-total', template: '{n} / {total}' },
  { id: 'dashes', template: '– {n} –' },
];

export const NUMBER_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

export const DEFAULT_NUMBERING = {
  position: 'bottom-center',
  format: 'n',
  start: 1,
  skipFirst: false,
  font: 'Helvetica',
  fontSize: 10,
  color: '#000000',
  /** Gap between the page edge and the number's box, in points (~⅖ in). */
  margin: 28,
};

/** "Page {n} of {total}" → "Page 3 of 9". */
export function formatPageNumber(formatId, n, total) {
  const format = NUMBER_FORMATS.find((f) => f.id === formatId) ?? NUMBER_FORMATS[0];
  return format.template.replace('{n}', String(n)).replace('{total}', String(total));
}

/**
 * The label for each of `count` pages (null = unnumbered). Page k gets
 * start + k − 1; "total" is the last number used, so a document numbered
 * from 5 reads "… of 12" on its last page. With `skipFirst`, page 1 is left
 * blank but still counts (page 2 shows start + 1), as for a cover page.
 */
export function pageNumberLabels(count, { format, start = 1, skipFirst = false } = {}) {
  const first = Math.trunc(Number(start)) || 0;
  const total = first + count - 1;
  return Array.from({ length: count }, (_, i) =>
    skipFirst && i === 0 ? null : formatPageNumber(format, first + i, total)
  );
}

/**
 * The page number as a text annotation (see lib/textLayout.js) for a page
 * whose visible box is `pageBox` (PDF space) shown at total `rotation`.
 * `textWidth` is the label's width in points (exact font metrics at export,
 * an on-screen measurement for the preview).
 */
export function pageNumberAnnotation(label, { pageBox, rotation }, style, textWidth) {
  const { position, font, fontSize, color, margin } = { ...DEFAULT_NUMBERING, ...style };
  const view = { pageBox, scale: 1, rotation };
  const sideways = rotation % 180 !== 0;
  const shownWidth = sideways ? pageBox.height : pageBox.width;
  const shownHeight = sideways ? pageBox.width : pageBox.height;
  const { height } = textLayout({ text: label, font, fontSize });

  const [vertical, horizontal] = position.split('-');
  const left =
    horizontal === 'left'
      ? margin
      : horizontal === 'right'
        ? shownWidth - margin - textWidth
        : (shownWidth - textWidth) / 2;
  const top = vertical === 'top' ? margin : shownHeight - margin - height;

  // Top-left of the text box on the page as shown → PDF space; the text is
  // oriented to read upright as shown.
  const topLeft = viewportToPdfPoint({ x: left, y: top }, view);
  return {
    id: 'page-number',
    type: 'text',
    text: label,
    font,
    fontSize,
    color,
    rotate: rotation,
    rect: rectFromTopLeft(topLeft, rotation, textWidth, height),
  };
}

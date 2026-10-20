/**
 * One-line summary of the inspector's top section, for the phone bottom
 * sheet while it's lowered (DESIGN.md › Layout, Phone). Pure: the caller
 * says what the top section is.
 *
 *   { stamps: { hasDocument } }
 *   { text: { label, font, size, missing } }   label: 'Text box' | 'New text'
 *   { annotation: { name } }
 *   { pages: { selected, current } }
 *
 * The pages line names what raising the sheet offers, not "Page 1 of 12":
 * the navigation right under it already says that.
 */
export function sheetSummary(top) {
  if (top.stamps) {
    return top.stamps.hasDocument
      ? 'Stamps · pick one, then tap the page'
      : 'Stamps · open a PDF to place them';
  }
  if (top.text) {
    const { label, font, size, missing = 0 } = top.text;
    const parts = [label, `${font} ${size}`];
    if (missing > 0) parts.push(`${missing} character${missing === 1 ? '' : 's'} won’t export`);
    return parts.join(' · ');
  }
  if (top.annotation) return top.annotation.name;
  if (top.pages) {
    const { selected, current } = top.pages;
    return `${selected > 1 ? `${selected} pages selected` : `Page ${current}`} · rotate, extract, delete`;
  }
  return 'No document open';
}

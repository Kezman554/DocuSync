/**
 * Form fields that appear on more than one page. Export drops a field from
 * every page when any of its pages is left out (deleted, not extracted, or
 * redacted — see isolateExcludedPages in exportPdf.js), because its value is
 * shared between them. These helpers let dialogs say so beforehand. Pure.
 */

/**
 * From pdf.js `getFieldObjects()` ({ name: [{ page }] }, or null): the
 * 0-based source pages of each field with widgets on two or more pages.
 */
export function sharedFieldPages(fieldObjects) {
  if (!fieldObjects) return [];
  return Object.values(fieldObjects)
    .map((widgets) => new Set(widgets.map((w) => w.page).filter((page) => page >= 0)))
    .filter((pageSet) => pageSet.size > 1);
}

/**
 * Whether exporting `entries` (page-model entries, any sources) would drop a
 * field from a page that is exported: one of its pages is in, another out.
 * `fieldsBySource` maps sourceId → sharedFieldPages(...).
 */
export function dropsSharedField(entries, fieldsBySource) {
  const keptBySource = new Map();
  for (const { sourceId, sourcePage } of entries) {
    if (!keptBySource.has(sourceId)) keptBySource.set(sourceId, new Set());
    keptBySource.get(sourceId).add(sourcePage - 1);
  }
  for (const [sourceId, kept] of keptBySource) {
    for (const pageSet of fieldsBySource[sourceId] ?? []) {
      const pagesOfField = [...pageSet];
      if (pagesOfField.some((p) => kept.has(p)) && pagesOfField.some((p) => !kept.has(p))) {
        return true;
      }
    }
  }
  return false;
}

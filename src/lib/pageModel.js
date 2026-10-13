/**
 * In-memory document model: an ordered list of page entries.
 *
 * Each entry points at a page in one of the loaded source PDFs (several when
 * merging) and carries the user's non-destructive edits (currently rotation).
 * Source documents are never modified — edits are only baked in on export.
 *
 *   {
 *     id: string,            unique across all sources, e.g. "s2-5"
 *     sourceId: string,      which loaded PDF, e.g. "s2"
 *     sourcePage: number,    1-based page within that PDF
 *     rotation: 0 | 90 | 180 | 270,
 *   }
 *
 * All functions are pure and return new arrays/sets rather than mutating.
 */

/** One entry per page of source `sourceId`, in source order. */
export function createPageModel(numPages, sourceId = 's1') {
  return Array.from({ length: Math.max(0, numPages | 0) }, (_, i) => ({
    id: `${sourceId}-${i + 1}`,
    sourceId,
    sourcePage: i + 1,
    rotation: 0,
  }));
}

/** Normalise any multiple of 90 into [0, 360). */
export function normalizeRotation(degrees) {
  const quarterTurns = Math.round(degrees / 90);
  return (((quarterTurns % 4) + 4) % 4) * 90;
}

/**
 * Rotate the pages whose ids are in `ids` by `delta` degrees
 * (+90 = clockwise / right, -90 = anticlockwise / left).
 */
export function rotatePages(pages, ids, delta) {
  const targets = ids instanceof Set ? ids : new Set(ids);
  if (targets.size === 0 || delta % 360 === 0) return pages;
  return pages.map((page) =>
    targets.has(page.id)
      ? { ...page, rotation: normalizeRotation(page.rotation + delta) }
      : page
  );
}

/**
 * Move the pages whose ids are in `ids` so they sit, as a block in their
 * current relative order, at insertion index `toIndex` of the ORIGINAL array
 * (0 = before the first page, pages.length = after the last). This matches a
 * drop indicator drawn between two existing thumbnails.
 */
export function movePages(pages, ids, toIndex) {
  const targets = ids instanceof Set ? ids : new Set(ids);
  if (targets.size === 0) return pages;
  const index = Math.max(0, Math.min(pages.length, toIndex));

  const moving = pages.filter((p) => targets.has(p.id));
  const rest = pages.filter((p) => !targets.has(p.id));
  // Where `index` lands once the moving pages are taken out.
  const insertAt = pages.slice(0, index).filter((p) => !targets.has(p.id)).length;
  const next = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];

  return next.every((p, i) => p === pages[i]) ? pages : next;
}

/**
 * Shift the targeted pages one slot up (-1) or down (+1) as a block.
 * No-op if the block is already at that end of the document.
 */
export function nudgePages(pages, ids, direction) {
  const targets = ids instanceof Set ? ids : new Set(ids);
  const indexes = pages.flatMap((p, i) => (targets.has(p.id) ? [i] : []));
  if (indexes.length === 0) return pages;
  const first = indexes[0];
  const last = indexes[indexes.length - 1];
  if (direction < 0) return first === 0 ? pages : movePages(pages, targets, first - 1);
  return last === pages.length - 1 ? pages : movePages(pages, targets, last + 2);
}

/** Remove the pages whose ids are in `ids`. */
export function deletePages(pages, ids) {
  const targets = ids instanceof Set ? ids : new Set(ids);
  if (targets.size === 0) return pages;
  const next = pages.filter((p) => !targets.has(p.id));
  return next.length === pages.length ? pages : next;
}

/**
 * Rotation to hand to pdf.js: the page's intrinsic /Rotate plus our edit.
 * (pdf.js `getViewport({ rotation })` replaces the intrinsic value rather
 * than adding to it, so we combine them here.)
 */
export function effectiveRotation(intrinsicRotate, rotation) {
  return normalizeRotation((intrinsicRotate || 0) + rotation);
}

/**
 * Compute the next selection after the user clicks page `id`.
 *
 * - plain click: select only that page
 * - toggle (Ctrl/Cmd): add/remove that page, keeping the rest
 * - range (Shift): select every page between `anchorId` and `id`
 *
 * Returns { selected: Set<string>, anchorId: string }.
 */
export function nextSelection(
  pages,
  selected,
  anchorId,
  id,
  { toggle = false, range = false } = {}
) {
  if (range && anchorId) {
    const from = pages.findIndex((p) => p.id === anchorId);
    const to = pages.findIndex((p) => p.id === id);
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      return {
        selected: new Set(pages.slice(lo, hi + 1).map((p) => p.id)),
        anchorId,
      };
    }
  }

  if (toggle) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { selected: next, anchorId: id };
  }

  return { selected: new Set([id]), anchorId: id };
}

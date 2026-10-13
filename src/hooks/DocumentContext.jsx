import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { loadPdfDocument } from '../lib/pdfLoader.js';
import {
  DEFAULT_SCALE,
  clampPage,
  zoomIn as zoomInScale,
  zoomOut as zoomOutScale,
} from '../lib/zoom.js';
import {
  createPageModel,
  deletePages as deletePagesModel,
  movePages as movePagesModel,
  nextSelection,
  nudgePages as nudgePagesModel,
  rotatePages,
} from '../lib/pageModel.js';
import {
  buildPdf,
  exportFileName,
  ExportError,
  extractFileName,
} from '../lib/exportPdf.js';
import { downloadBytes } from '../lib/download.js';

/**
 * Shared application state for the loaded PDFs, page model, selection, and zoom.
 *
 * `sources` holds every loaded PDF (one normally; more after merging), each
 * with its read-only pdf.js proxy and original File. The page model is a
 * single ordered list of { id, sourceId, sourcePage, rotation } entries across
 * all sources, so pages can be reordered freely between documents.
 * `currentPage` is a 1-based position in that list.
 */
const DocumentContext = createContext(null);

function describeFailures(failures) {
  if (failures.length === 1) {
    const [f] = failures;
    return `Couldn’t open “${f.name}”${f.message ? `: ${f.message}` : '.'}`;
  }
  return `Couldn’t open ${failures.length} files: ${failures
    .map((f) => `“${f.name}”`)
    .join(', ')}.`;
}

export function DocumentProvider({ children }) {
  // [{ id, name, size, numPages, pdfDoc, file }] — the first is the primary
  // document. The File is kept so export can re-read pristine bytes (pdf.js
  // transfers the buffer it was given to its worker, detaching it).
  const [sources, setSources] = useState([]);
  const [pages, setPages] = useState([]); // see lib/pageModel.js
  const [selected, setSelected] = useState(() => new Set()); // page ids
  const [anchorId, setAnchorId] = useState(null); // shift-click range anchor
  const [pendingDelete, setPendingDelete] = useState(null); // page ids awaiting confirmation
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState(null); // dismissible error message

  // Track the most recent open/close so a slow load can't clobber a newer one.
  const loadTokenRef = useRef(0);
  const nextSourceRef = useRef(1);
  // Latest committed values, for async actions that finish later.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const sourcesById = useMemo(
    () => Object.fromEntries(sources.map((src) => [src.id, src])),
    [sources]
  );
  const primary = sources[0] ?? null;
  const document = useMemo(
    () =>
      primary && {
        name: primary.name,
        size: primary.size,
        numPages: primary.numPages,
      },
    [primary]
  );

  const closeDocument = useCallback(() => {
    loadTokenRef.current += 1;
    sourcesRef.current.forEach((src) => src.pdfDoc?.destroy?.());
    setSources([]);
    setPages([]);
    setSelected(new Set());
    setAnchorId(null);
    setPendingDelete(null);
    setCurrentPage(1);
    setScale(DEFAULT_SCALE);
    setStatus('idle');
    setError(null);
    setAdding(false);
    setExporting(false);
    setNotice(null);
  }, []);

  /**
   * Load `files` with pdf.js, giving each a new source id. Files that fail
   * are reported in `failures` rather than aborting the rest.
   */
  const loadSources = useCallback(async (files) => {
    const results = await Promise.allSettled(files.map((f) => loadPdfDocument(f)));
    const loaded = [];
    const failures = [];
    results.forEach((result, i) => {
      const file = files[i];
      if (result.status === 'fulfilled') {
        const pdfDoc = result.value;
        loaded.push({
          id: `s${nextSourceRef.current++}`,
          name: file.name,
          size: file.size,
          numPages: pdfDoc.numPages,
          pdfDoc,
          file,
        });
      } else {
        failures.push({ name: file.name, message: result.reason?.message });
      }
    });
    return { loaded, failures };
  }, []);

  /** Open one or more PDFs as a new document (several are merged, in order). */
  const openDocuments = useCallback(
    async (files) => {
      const list = Array.from(files ?? []);
      if (list.length === 0) return;
      const token = (loadTokenRef.current += 1);
      setStatus('loading');
      setError(null);

      const { loaded, failures } = await loadSources(list);
      if (loadTokenRef.current !== token) {
        // A newer open/close happened while we were loading — discard this one.
        loaded.forEach((src) => src.pdfDoc?.destroy?.());
        return;
      }

      sourcesRef.current.forEach((src) => src.pdfDoc?.destroy?.());
      setPendingDelete(null);
      setAdding(false);
      setExporting(false);
      setScale(DEFAULT_SCALE);
      setCurrentPage(1);

      if (loaded.length === 0) {
        setError(failures[0]?.message ?? 'Failed to open PDF');
        setStatus('error');
        setSources([]);
        setPages([]);
        setSelected(new Set());
        setAnchorId(null);
        setNotice(null);
        return;
      }

      const model = loaded.flatMap((src) => createPageModel(src.numPages, src.id));
      setSources(loaded);
      setPages(model);
      setSelected(new Set([model[0].id]));
      setAnchorId(model[0].id);
      setNotice(failures.length ? describeFailures(failures) : null);
      setStatus('ready');
    },
    [loadSources]
  );

  const openDocument = useCallback(
    (file) => (file ? openDocuments([file]) : undefined),
    [openDocuments]
  );

  /**
   * Merge: load more PDFs and append their pages to the end of the model.
   * The new pages become the selection and the first of them is shown.
   */
  const addDocuments = useCallback(
    async (files) => {
      const list = Array.from(files ?? []);
      if (list.length === 0) return;
      if (sourcesRef.current.length === 0) {
        await openDocuments(list);
        return;
      }
      const token = loadTokenRef.current;
      setAdding(true);
      setNotice(null);

      const { loaded, failures } = await loadSources(list);
      if (loadTokenRef.current !== token) {
        loaded.forEach((src) => src.pdfDoc?.destroy?.());
        return;
      }
      setAdding(false);
      if (failures.length) setNotice(describeFailures(failures));
      if (loaded.length === 0) return;

      const added = loaded.flatMap((src) => createPageModel(src.numPages, src.id));
      const before = pagesRef.current;
      setSources((prev) => [...prev, ...loaded]);
      setPages([...before, ...added]);
      setSelected(new Set(added.map((p) => p.id)));
      setAnchorId(added[0].id);
      setCurrentPage(before.length + 1);
    },
    [loadSources, openDocuments]
  );

  const numPages = pages.length;

  // Plain navigation moves the selection with it (single page selected).
  const goToPage = useCallback(
    (position) => {
      const p = clampPage(position, pages.length);
      setCurrentPage(p);
      const entry = pages[p - 1];
      if (entry) {
        setSelected(new Set([entry.id]));
        setAnchorId(entry.id);
      }
    },
    [pages]
  );
  const nextPage = useCallback(
    () => goToPage(currentPage + 1),
    [goToPage, currentPage]
  );
  const prevPage = useCallback(
    () => goToPage(currentPage - 1),
    [goToPage, currentPage]
  );

  /** Thumbnail click: update selection (Ctrl/Cmd toggles, Shift ranges) and show the page. */
  const selectPage = useCallback(
    (id, modifiers) => {
      const result = nextSelection(pages, selected, anchorId, id, modifiers);
      setSelected(result.selected);
      setAnchorId(result.anchorId);
      const index = pages.findIndex((p) => p.id === id);
      if (index !== -1) setCurrentPage(index + 1);
    },
    [pages, selected, anchorId]
  );

  // Page operations act on the selected pages, or the current page if none.
  const targetIds = useMemo(() => {
    if (selected.size > 0) return selected;
    const current = pages[currentPage - 1];
    return new Set(current ? [current.id] : []);
  }, [selected, pages, currentPage]);

  const rotateSelected = useCallback(
    (delta) => setPages((prev) => rotatePages(prev, targetIds, delta)),
    [targetIds]
  );
  const rotateLeft = useCallback(() => rotateSelected(-90), [rotateSelected]);
  const rotateRight = useCallback(() => rotateSelected(90), [rotateSelected]);

  // After a reorder, keep showing the same page (by id) at its new position.
  const applyReorder = useCallback(
    (next) => {
      if (next === pages) return;
      const currentId = pages[currentPage - 1]?.id;
      setPages(next);
      const index = next.findIndex((p) => p.id === currentId);
      if (index !== -1) setCurrentPage(index + 1);
    },
    [pages, currentPage]
  );

  /** Drag-drop: move `ids` to insertion index `toIndex` (see lib/pageModel.js). */
  const movePages = useCallback(
    (ids, toIndex) => applyReorder(movePagesModel(pages, ids, toIndex)),
    [applyReorder, pages]
  );

  /** Keyboard reorder: shift the target pages one slot up (-1) or down (+1). */
  const nudgeSelected = useCallback(
    (direction) => applyReorder(nudgePagesModel(pages, targetIds, direction)),
    [applyReorder, pages, targetIds]
  );

  // Deleting every page would leave nothing to view or export.
  const canDelete = targetIds.size > 0 && targetIds.size < pages.length;

  /** Ask for confirmation before deleting the target pages. */
  const requestDelete = useCallback(() => {
    if (canDelete) setPendingDelete([...targetIds]);
  }, [canDelete, targetIds]);
  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const next = deletePagesModel(pages, pendingDelete);
    setPendingDelete(null);
    if (next === pages || next.length === 0) return;

    // Stay on the current page if it survived; otherwise land on the page
    // that now occupies the first deleted slot (or the new last page).
    const currentId = pages[currentPage - 1]?.id;
    let index = next.findIndex((p) => p.id === currentId);
    if (index === -1) {
      const removed = new Set(pendingDelete);
      const firstRemoved = pages.findIndex((p) => removed.has(p.id));
      index = Math.min(firstRemoved, next.length - 1);
    }
    setPages(next);
    setCurrentPage(index + 1);
    setSelected(new Set([next[index].id]));
    setAnchorId(next[index].id);
  }, [pendingDelete, pages, currentPage]);

  /**
   * Build a PDF from `entries` (a slice of the page model) and download it.
   * Shared by full export and page extraction. Resolves true on success.
   * `makeFileName(primaryName, merged)` names the download.
   */
  const runExport = useCallback(
    async (entries, makeFileName) => {
      if (!primary || entries.length === 0) return false;
      const token = loadTokenRef.current;
      setExporting(true);
      setNotice(null);
      try {
        // Re-read only the source files these pages actually come from.
        const usedIds = [...new Set(entries.map((p) => p.sourceId))];
        const inputs = {};
        for (const id of usedIds) {
          const src = sourcesById[id];
          if (src) inputs[id] = { name: src.name, bytes: await src.file.arrayBuffer() };
        }
        const bytes = await buildPdf(inputs, entries);
        if (loadTokenRef.current !== token) return false; // document changed meanwhile
        downloadBytes(bytes, makeFileName(primary.name, usedIds.length > 1));
        return true;
      } catch (err) {
        if (loadTokenRef.current !== token) return false;
        // eslint-disable-next-line no-console
        console.error('Export failed', err);
        setNotice(
          err instanceof ExportError ? err.message : 'Export failed. Please try again.'
        );
        return false;
      } finally {
        if (loadTokenRef.current === token) setExporting(false);
      }
    },
    [primary, sourcesById]
  );

  /** Bake the whole page model into a new PDF and download it. */
  const exportDocument = useCallback(
    () => runExport(pages, (name, merged) => exportFileName(name, { merged })),
    [runExport, pages]
  );

  /**
   * Split: extract the pages at 1-based `positions` (current edited order,
   * rotations included) into a new PDF and download it.
   */
  const extractPages = useCallback(
    (positions) => {
      const entries = positions.map((n) => pages[n - 1]).filter(Boolean);
      return runExport(entries, (name) => extractFileName(name, positions));
    },
    [runExport, pages]
  );
  const dismissNotice = useCallback(() => setNotice(null), []);

  const zoomIn = useCallback(() => setScale((s) => zoomInScale(s)), []);
  const zoomOut = useCallback(() => setScale((s) => zoomOutScale(s)), []);
  const resetZoom = useCallback(() => setScale(DEFAULT_SCALE), []);

  const value = useMemo(
    () => ({
      document,
      sources,
      sourcesById,
      hasDocument: sources.length > 0,
      pages,
      numPages,
      currentPage,
      currentEntry: pages[currentPage - 1] ?? null,
      selected,
      targetIds,
      pendingDelete,
      canDelete,
      scale,
      status,
      error,
      adding,
      exporting,
      notice,
      openDocument,
      openDocuments,
      addDocuments,
      closeDocument,
      goToPage,
      nextPage,
      prevPage,
      setCurrentPage,
      selectPage,
      rotateLeft,
      rotateRight,
      movePages,
      nudgeSelected,
      requestDelete,
      cancelDelete,
      confirmDelete,
      exportDocument,
      extractPages,
      dismissNotice,
      zoomIn,
      zoomOut,
      resetZoom,
    }),
    [
      document,
      sources,
      sourcesById,
      pages,
      numPages,
      currentPage,
      selected,
      targetIds,
      pendingDelete,
      canDelete,
      scale,
      status,
      error,
      adding,
      exporting,
      notice,
      openDocument,
      openDocuments,
      addDocuments,
      closeDocument,
      goToPage,
      nextPage,
      prevPage,
      selectPage,
      rotateLeft,
      rotateRight,
      movePages,
      nudgeSelected,
      requestDelete,
      cancelDelete,
      confirmDelete,
      exportDocument,
      extractPages,
      dismissNotice,
      zoomIn,
      zoomOut,
      resetZoom,
    ]
  );

  return (
    <DocumentContext.Provider value={value}>
      {children}
    </DocumentContext.Provider>
  );
}

export function useDocumentContext() {
  const ctx = useContext(DocumentContext);
  if (ctx === null) {
    throw new Error('useDocumentContext must be used within a DocumentProvider');
  }
  return ctx;
}

export default DocumentContext;

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
import { createPageModel, nextSelection, rotatePages } from '../lib/pageModel.js';

/**
 * Shared application state for the loaded PDF, page model, selection, and zoom.
 *
 * Holds the pdf.js PDFDocumentProxy (read-only source) plus the in-memory page
 * model — an ordered list of { id, sourcePage, rotation } entries that carries
 * the user's non-destructive edits. `currentPage` is a 1-based position in that
 * list, not a source page number.
 */
const DocumentContext = createContext(null);

export function DocumentProvider({ children }) {
  const [document, setDocument] = useState(null); // { name, size, numPages }
  const [pdfDoc, setPdfDoc] = useState(null); // pdf.js PDFDocumentProxy
  const [pages, setPages] = useState([]); // see lib/pageModel.js
  const [selected, setSelected] = useState(() => new Set()); // page ids
  const [anchorId, setAnchorId] = useState(null); // shift-click range anchor
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [error, setError] = useState(null);

  // Track the most recent open request so a slow load can't clobber a newer one.
  const loadTokenRef = useRef(0);

  const closeDocument = useCallback(() => {
    loadTokenRef.current += 1;
    setPdfDoc((prev) => {
      prev?.destroy?.();
      return null;
    });
    setDocument(null);
    setPages([]);
    setSelected(new Set());
    setAnchorId(null);
    setCurrentPage(1);
    setScale(DEFAULT_SCALE);
    setStatus('idle');
    setError(null);
  }, []);

  const openDocument = useCallback(async (file) => {
    if (!file) return;
    const token = (loadTokenRef.current += 1);
    setStatus('loading');
    setError(null);
    try {
      const pdf = await loadPdfDocument(file);
      if (loadTokenRef.current !== token) {
        // A newer open/close happened while we were loading — discard this one.
        pdf?.destroy?.();
        return;
      }
      setPdfDoc((prev) => {
        prev?.destroy?.();
        return pdf;
      });
      const model = createPageModel(pdf.numPages);
      setPages(model);
      setSelected(new Set(model[0] ? [model[0].id] : []));
      setAnchorId(model[0]?.id ?? null);
      setDocument({ name: file.name, size: file.size, numPages: pdf.numPages });
      setCurrentPage(1);
      setScale(DEFAULT_SCALE);
      setStatus('ready');
    } catch (err) {
      if (loadTokenRef.current !== token) return;
      setError(err?.message ?? 'Failed to open PDF');
      setStatus('error');
      setPdfDoc(null);
      setDocument(null);
      setPages([]);
      setSelected(new Set());
      setAnchorId(null);
    }
  }, []);

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

  // Rotate the selected pages, or the current page if nothing is selected.
  const rotateSelected = useCallback(
    (delta) => {
      const targets =
        selected.size > 0
          ? selected
          : new Set(pages[currentPage - 1] ? [pages[currentPage - 1].id] : []);
      setPages((prev) => rotatePages(prev, targets, delta));
    },
    [selected, pages, currentPage]
  );
  const rotateLeft = useCallback(() => rotateSelected(-90), [rotateSelected]);
  const rotateRight = useCallback(() => rotateSelected(90), [rotateSelected]);

  const zoomIn = useCallback(() => setScale((s) => zoomInScale(s)), []);
  const zoomOut = useCallback(() => setScale((s) => zoomOutScale(s)), []);
  const resetZoom = useCallback(() => setScale(DEFAULT_SCALE), []);

  const value = useMemo(
    () => ({
      document,
      pdfDoc,
      hasDocument: pdfDoc !== null,
      pages,
      numPages,
      currentPage,
      currentEntry: pages[currentPage - 1] ?? null,
      selected,
      scale,
      status,
      error,
      openDocument,
      closeDocument,
      goToPage,
      nextPage,
      prevPage,
      setCurrentPage,
      selectPage,
      rotateLeft,
      rotateRight,
      zoomIn,
      zoomOut,
      resetZoom,
    }),
    [
      document,
      pdfDoc,
      pages,
      numPages,
      currentPage,
      selected,
      scale,
      status,
      error,
      openDocument,
      closeDocument,
      goToPage,
      nextPage,
      prevPage,
      selectPage,
      rotateLeft,
      rotateRight,
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

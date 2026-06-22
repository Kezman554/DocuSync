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

/**
 * Shared application state for the loaded PDF, current page, and zoom.
 *
 * Holds the pdf.js PDFDocumentProxy plus lightweight metadata, and exposes
 * actions to open/close a document, navigate pages, and zoom.
 */
const DocumentContext = createContext(null);

export function DocumentProvider({ children }) {
  const [document, setDocument] = useState(null); // { name, size, numPages }
  const [pdfDoc, setPdfDoc] = useState(null); // pdf.js PDFDocumentProxy
  const [numPages, setNumPages] = useState(0);
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
    setNumPages(0);
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
      setNumPages(pdf.numPages);
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
      setNumPages(0);
    }
  }, []);

  const goToPage = useCallback(
    (page) => setCurrentPage(clampPage(page, numPages)),
    [numPages]
  );
  const nextPage = useCallback(
    () => setCurrentPage((p) => clampPage(p + 1, numPages)),
    [numPages]
  );
  const prevPage = useCallback(
    () => setCurrentPage((p) => clampPage(p - 1, numPages)),
    [numPages]
  );

  const zoomIn = useCallback(() => setScale((s) => zoomInScale(s)), []);
  const zoomOut = useCallback(() => setScale((s) => zoomOutScale(s)), []);
  const resetZoom = useCallback(() => setScale(DEFAULT_SCALE), []);

  const value = useMemo(
    () => ({
      document,
      pdfDoc,
      hasDocument: pdfDoc !== null,
      numPages,
      currentPage,
      scale,
      status,
      error,
      openDocument,
      closeDocument,
      goToPage,
      nextPage,
      prevPage,
      setCurrentPage,
      zoomIn,
      zoomOut,
      resetZoom,
    }),
    [
      document,
      pdfDoc,
      numPages,
      currentPage,
      scale,
      status,
      error,
      openDocument,
      closeDocument,
      goToPage,
      nextPage,
      prevPage,
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

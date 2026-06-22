import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Shared application state for the loaded PDF and the current page.
 *
 * The actual PDF parsing/rendering pipeline lands in a later task; for now
 * this holds the document metadata (file handle, name, page count) and the
 * current page index, with actions to open and close a document.
 */
const DocumentContext = createContext(null);

export function DocumentProvider({ children }) {
  const [document, setDocument] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  const openDocument = useCallback((file) => {
    if (!file) return;
    setDocument({
      file,
      name: file.name,
      size: file.size,
      // numPages is populated once the PDF is parsed (later task).
      numPages: null,
    });
    setCurrentPage(1);
  }, []);

  const closeDocument = useCallback(() => {
    setDocument(null);
    setCurrentPage(1);
  }, []);

  const value = useMemo(
    () => ({
      document,
      hasDocument: document !== null,
      currentPage,
      setCurrentPage,
      openDocument,
      closeDocument,
    }),
    [document, currentPage, openDocument, closeDocument]
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

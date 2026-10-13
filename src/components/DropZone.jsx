import { useCallback, useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import './DropZone.css';

function isPdf(file) {
  return (
    file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))
  );
}

/**
 * Wraps the app body and accepts a PDF dropped anywhere over it.
 * A counter tracks nested dragenter/dragleave events so the overlay
 * doesn't flicker as the cursor moves across child elements.
 */
function DropZone({ children }) {
  const { hasDocument, openDocuments, addDocuments } = useDocumentContext();
  const [dragging, setDragging] = useState(false);
  const depthRef = useRef(0);

  const handleDragEnter = useCallback((e) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
    e.preventDefault();
    depthRef.current += 1;
    setDragging(true);
  }, []);

  const handleDragOver = useCallback((e) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      depthRef.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []).filter(isPdf);
      if (files.length === 0) return;
      // With a document open, dropped PDFs are merged in (appended);
      // otherwise they're opened (several at once = merged in drop order).
      if (hasDocument) addDocuments(files);
      else openDocuments(files);
    },
    [hasDocument, addDocuments, openDocuments]
  );

  return (
    <div
      className="dropzone"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragging && (
        <div className="dropzone__overlay" aria-hidden="true">
          <div className="dropzone__hint">
            {hasDocument ? 'Drop PDFs to add their pages' : 'Drop PDF to open'}
          </div>
        </div>
      )}
    </div>
  );
}

export default DropZone;

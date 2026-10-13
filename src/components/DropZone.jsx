import { useCallback, useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import './DropZone.css';

function isImage(file) {
  return file && (/^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp|avif|heic)$/i.test(file.name));
}

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
  const { hasDocument, openDocuments, addDocuments, requestImagesToPdf } = useDocumentContext();
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
      const dropped = Array.from(e.dataTransfer?.files ?? []);
      const pdfs = dropped.filter(isPdf);
      const images = dropped.filter((f) => !isPdf(f) && isImage(f));
      // With a document open, dropped PDFs are merged in (appended);
      // otherwise they're opened (several at once = merged in drop order).
      if (pdfs.length) {
        if (hasDocument) addDocuments(pdfs);
        else openDocuments(pdfs);
      } else if (images.length) {
        requestImagesToPdf(images); // images only → offer to make a PDF
      }
    },
    [hasDocument, addDocuments, openDocuments, requestImagesToPdf]
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
            {hasDocument
              ? 'Drop PDFs to add their pages, or images to make a PDF'
              : 'Drop a PDF to open, or images to make a PDF'}
          </div>
        </div>
      )}
    </div>
  );
}

export default DropZone;

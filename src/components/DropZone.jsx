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
  const { openDocument } = useDocumentContext();
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
      const file = Array.from(e.dataTransfer?.files ?? []).find(isPdf);
      if (file) openDocument(file);
    },
    [openDocument]
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
          <div className="dropzone__hint">Drop PDF to open</div>
        </div>
      )}
    </div>
  );
}

export default DropZone;

import { useRef } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import './EmptyState.css';

function EmptyState() {
  const { openDocuments } = useDocumentContext();
  const inputRef = useRef(null);

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    openDocuments(files); // several files open merged, in selection order
  };

  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">
        📄
      </div>
      <h2 className="empty-state__title">Open a PDF to get started</h2>
      <p className="empty-state__text">
        Everything happens locally in your browser — nothing is uploaded.
      </p>
      <button
        type="button"
        className="empty-state__btn"
        onClick={() => inputRef.current?.click()}
      >
        Open PDF
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="empty-state__file-input"
        onChange={handleFileChange}
      />
    </div>
  );
}

export default EmptyState;

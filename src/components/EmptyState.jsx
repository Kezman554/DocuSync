import { useRef } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import './EmptyState.css';

/** Shown in the well until a PDF is open. The only privacy claim is about the file. */
function EmptyState() {
  const { openDocuments, requestImagesToPdf } = useDocumentContext();
  const inputRef = useRef(null);
  const imagesRef = useRef(null);

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    openDocuments(files); // several files open merged, in selection order
  };

  return (
    <div className="empty-state">
      {/* A document with a padlock on it. */}
      <svg className="empty-state__icon" viewBox="0 0 48 48" aria-hidden="true">
        <path
          d="M12 5h17l9 9v29H12z M29 5v9h9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <rect x="20" y="27" width="14" height="11" rx="2" fill="currentColor" />
        <path d="M23 27v-3a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2.5" />
      </svg>
      <h2 className="empty-state__title">Open a PDF to get started</h2>
      <p className="empty-state__text">
        Everything happens here in your browser. Your file is never uploaded.
      </p>
      <button
        type="button"
        className="empty-state__btn"
        onClick={() => inputRef.current?.click()}
      >
        Open PDF
      </button>
      <button
        type="button"
        className="empty-state__btn empty-state__btn--secondary"
        onClick={() => imagesRef.current?.click()}
      >
        Create PDF from images
      </button>
      <p className="empty-state__drop">or drop a PDF anywhere on this page</p>
      <input
        ref={imagesRef}
        type="file"
        accept="image/*"
        multiple
        className="empty-state__file-input"
        aria-label="Choose images"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          requestImagesToPdf(files);
        }}
      />
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

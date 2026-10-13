import { useRef } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import './Toolbar.css';

function Toolbar({ onToggleSidebar }) {
  const {
    hasDocument,
    document,
    openDocument,
    closeDocument,
    exporting,
    exportError,
    exportDocument,
    dismissExportError,
  } = useDocumentContext();
  const inputRef = useRef(null);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) openDocument(file);
    // Reset so selecting the same file again re-triggers change.
    event.target.value = '';
  };

  return (
    <header className="toolbar">
      <div className="toolbar__group">
        {hasDocument && (
          <button
            type="button"
            className="toolbar__icon-btn toolbar__sidebar-toggle"
            onClick={onToggleSidebar}
            aria-label="Toggle thumbnails"
            title="Toggle thumbnails"
          >
            ☰
          </button>
        )}
        <span className="toolbar__brand">DocuSync</span>
      </div>

      <div className="toolbar__group toolbar__group--center">
        {hasDocument && (
          <span className="toolbar__filename" title={document.name}>
            {document.name}
          </span>
        )}
      </div>

      <div className="toolbar__group toolbar__group--end">
        {hasDocument && (
          <button
            type="button"
            className="toolbar__btn"
            onClick={exportDocument}
            disabled={exporting}
            aria-busy={exporting}
            title="Download a new PDF with your page edits applied"
          >
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        )}
        <button
          type="button"
          className={`toolbar__btn${hasDocument ? ' toolbar__btn--ghost' : ''}`}
          onClick={() => inputRef.current?.click()}
        >
          {hasDocument ? 'Open another' : 'Open PDF'}
        </button>
        {hasDocument && (
          <button
            type="button"
            className="toolbar__btn toolbar__btn--ghost"
            onClick={closeDocument}
          >
            Close
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="toolbar__file-input"
          onChange={handleFileChange}
        />
      </div>

      {exportError && (
        <div className="toolbar__alert" role="alert">
          <span>{exportError}</span>
          <button
            type="button"
            className="toolbar__icon-btn"
            onClick={dismissExportError}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </header>
  );
}

export default Toolbar;

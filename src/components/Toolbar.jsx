import { useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import ExtractPagesDialog from './ExtractPagesDialog.jsx';
import './Toolbar.css';

function Toolbar({ onToggleSidebar, stampsOpen = false, onToggleStamps }) {
  const {
    hasDocument,
    document,
    sources,
    openDocuments,
    addDocuments,
    closeDocument,
    adding,
    exporting,
    notice,
    exportDocument,
    dismissNotice,
  } = useDocumentContext();
  const inputRef = useRef(null);
  const addInputRef = useRef(null);
  const [extractOpen, setExtractOpen] = useState(false);

  // Copy the FileList before resetting the input (reset empties it).
  const takeFiles = (event) => {
    const files = Array.from(event.target.files ?? []);
    // Reset so selecting the same file again re-triggers change.
    event.target.value = '';
    return files;
  };
  const handleFileChange = (event) => openDocuments(takeFiles(event));
  const handleAddChange = (event) => addDocuments(takeFiles(event));

  const extraSources = sources.length - 1;

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
          <span
            className="toolbar__filename"
            title={sources.map((src) => src.name).join('\n')}
          >
            {document.name}
            {extraSources > 0 && ` + ${extraSources} more`}
          </span>
        )}
      </div>

      <div className="toolbar__group toolbar__group--end">
        <button
          type="button"
          className={`toolbar__btn toolbar__btn--ghost${stampsOpen ? ' toolbar__btn--on' : ''}`}
          onClick={onToggleStamps}
          aria-expanded={stampsOpen}
          aria-controls="stamps-panel"
          title="Stamps library: ticks, initials and signatures"
        >
          Stamps
        </button>
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
        {hasDocument && (
          <button
            type="button"
            className="toolbar__btn toolbar__btn--ghost"
            onClick={() => setExtractOpen(true)}
            disabled={exporting}
            title="Save selected pages or ranges as a new PDF"
          >
            Extract pages…
          </button>
        )}
        {hasDocument && (
          <button
            type="button"
            className="toolbar__btn toolbar__btn--ghost"
            onClick={() => addInputRef.current?.click()}
            disabled={adding}
            aria-busy={adding}
            title="Merge: append pages from other PDFs"
          >
            {adding ? 'Adding…' : 'Add PDF…'}
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
          multiple
          className="toolbar__file-input"
          onChange={handleFileChange}
          aria-label="Open PDF files"
        />
        <input
          ref={addInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="toolbar__file-input"
          onChange={handleAddChange}
          aria-label="Add PDF files"
        />
      </div>

      {extractOpen && hasDocument && (
        <ExtractPagesDialog onClose={() => setExtractOpen(false)} />
      )}

      {notice && (
        <div className="toolbar__alert" role="alert">
          <span>{notice}</span>
          <button
            type="button"
            className="toolbar__icon-btn"
            onClick={dismissNotice}
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

import { useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import ExtractPagesDialog from './ExtractPagesDialog.jsx';
import ExportImagesDialog from './ExportImagesDialog.jsx';
import CompressDialog from './CompressDialog.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import ProtectDialog from './ProtectDialog.jsx';
import ProtectOffer, { UNPROTECTED_SENTENCE } from './ProtectOffer.jsx';
import { redactionWarning } from '../lib/redaction.js';
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
    progress,
    notice,
    exportDocument,
    redactedPages,
    hadPassword,
    requestImagesToPdf,
    dismissNotice,
  } = useDocumentContext();
  const inputRef = useRef(null);
  const addInputRef = useRef(null);
  const imagesInputRef = useRef(null);
  const [extractOpen, setExtractOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [compressOpen, setCompressOpen] = useState(false);
  // Plain Export PDF asks first if pages are redacted or a source had a password.
  const [exportConfirm, setExportConfirm] = useState(false);
  const [protectOpen, setProtectOpen] = useState(false);
  // "Export with password…" offered from another dialog: swap to it.
  const openProtect = () => {
    setExtractOpen(false);
    setCompressOpen(false);
    setProtectOpen(true);
  };

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
            // Say so before exporting if redacted pages become images, or
            // if the original had a password this export won't have.
            onClick={() =>
              redactedPages.length || hadPassword ? setExportConfirm(true) : exportDocument()
            }
            disabled={exporting}
            aria-busy={exporting}
            title="Download a new PDF with your page edits applied"
          >
            {exporting
              ? progress
                ? `Rendering ${progress.done}/${progress.total}…`
                : 'Exporting…'
              : 'Export PDF'}
          </button>
        )}
        {hasDocument && (
          <button
            type="button"
            className="toolbar__btn toolbar__btn--ghost"
            onClick={() => setProtectOpen(true)}
            disabled={exporting}
            title="Download the edited PDF encrypted with a password"
          >
            Export with password…
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
            onClick={() => setImagesOpen(true)}
            disabled={exporting}
            title="Save pages as PNG or JPG images"
          >
            Export images…
          </button>
        )}
        {hasDocument && (
          <button
            type="button"
            className="toolbar__btn toolbar__btn--ghost"
            onClick={() => setCompressOpen(true)}
            disabled={exporting}
            title="Download a smaller copy: re-encode images, strip metadata"
          >
            Compress…
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
          className="toolbar__btn toolbar__btn--ghost"
          onClick={() => imagesInputRef.current?.click()}
          title="Create a PDF from photos or images"
        >
          From images…
        </button>
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
        <input
          ref={imagesInputRef}
          type="file"
          accept="image/*"
          multiple
          className="toolbar__file-input"
          onChange={(event) => requestImagesToPdf(takeFiles(event))}
          aria-label="Choose images for a new PDF"
        />
      </div>

      {extractOpen && hasDocument && (
        <ExtractPagesDialog onClose={() => setExtractOpen(false)} onProtect={openProtect} />
      )}
      {imagesOpen && hasDocument && (
        <ExportImagesDialog onClose={() => setImagesOpen(false)} />
      )}
      {compressOpen && hasDocument && (
        <CompressDialog onClose={() => setCompressOpen(false)} onProtect={openProtect} />
      )}
      {protectOpen && hasDocument && <ProtectDialog onClose={() => setProtectOpen(false)} />}
      {exportConfirm && hasDocument && (
        <ConfirmDialog
          title={redactedPages.length ? 'Export with redactions?' : 'Export without a password?'}
          message={
            redactedPages.length ? redactionWarning(redactedPages.length) : UNPROTECTED_SENTENCE
          }
          confirmLabel="Export PDF"
          onConfirm={() => {
            setExportConfirm(false);
            exportDocument();
          }}
          onCancel={() => setExportConfirm(false)}
        >
          {hadPassword && (
            <ProtectOffer
              sentence={redactedPages.length > 0}
              onProtect={() => {
                setExportConfirm(false);
                openProtect();
              }}
            />
          )}
        </ConfirmDialog>
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

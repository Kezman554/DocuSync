import { useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import ExtractPagesDialog from './ExtractPagesDialog.jsx';
import ExportImagesDialog from './ExportImagesDialog.jsx';
import CompressDialog from './CompressDialog.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import ProtectDialog from './ProtectDialog.jsx';
import ProtectOffer from './ProtectOffer.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import MenuButton from './MenuButton.jsx';
import { redactionWarning } from '../lib/redaction.js';
import './Toolbar.css';

function Toolbar({ onToggleSidebar }) {
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
    missingCharsFor,
    missingCharsNote,
    loadTextCheck,
    textCheck,
    numPages,
    requestImagesToPdf,
    dismissNotice,
  } = useDocumentContext();
  const inputRef = useRef(null);
  const addInputRef = useRef(null);
  const imagesInputRef = useRef(null);
  const [extractOpen, setExtractOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [compressOpen, setCompressOpen] = useState(false);
  // Plain Export PDF asks first if pages are redacted, a source had a
  // password, or some added text won't come out.
  const [exportConfirm, setExportConfirm] = useState(false);
  const allPages = Array.from({ length: numPages }, (_, i) => i + 1);
  const missingNote = hasDocument ? missingCharsNote(allPages) : null;

  // Wait for the character check if it's somehow still loading, so the
  // warning can't be skipped by exporting the moment a file opens.
  const handleExport = async () => {
    const check = textCheck ?? (await loadTextCheck());
    const missing = check?.missingCharsWarning(missingCharsFor(allPages, check));
    if (redactedPages.length || hadPassword || missing) setExportConfirm(true);
    else exportDocument();
  };
  const [protectOpen, setProtectOpen] = useState(false);
  // "Export with password…" offered from another dialog: swap to it.
  const openProtect = () => {
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

  const fileItems = hasDocument
    ? [
        { label: 'Open another', onSelect: () => inputRef.current?.click() },
        {
          label: adding ? 'Adding…' : 'Add PDF…',
          onSelect: () => addInputRef.current?.click(),
          disabled: adding,
          title: 'Merge: append pages from other PDFs',
        },
        {
          label: 'From images…',
          onSelect: () => imagesInputRef.current?.click(),
          title: 'Create a PDF from photos or images',
        },
        { label: 'Close', onSelect: closeDocument },
      ]
    : [
        { label: 'Open PDF…', onSelect: () => inputRef.current?.click() },
        {
          label: 'From images…',
          onSelect: () => imagesInputRef.current?.click(),
          title: 'Create a PDF from photos or images',
        },
      ];

  const exportItems = [
    {
      label: 'Export with password…',
      onSelect: () => setProtectOpen(true),
      disabled: exporting,
      title: 'Download the edited PDF encrypted with a password',
    },
    {
      label: 'Extract pages…',
      onSelect: () => setExtractOpen(true),
      disabled: exporting,
      title: 'Save selected pages or ranges as a new PDF',
    },
    {
      label: 'Export images…',
      onSelect: () => setImagesOpen(true),
      disabled: exporting,
      title: 'Save pages as PNG or JPG images',
    },
    {
      label: 'Compress…',
      onSelect: () => setCompressOpen(true),
      disabled: exporting,
      title: 'Download a smaller copy: re-encode images, strip metadata',
    },
  ];

  return (
    <header className="toolbar">
      <div className="toolbar__group toolbar__group--start">
        {hasDocument && (
          <button
            type="button"
            className="toolbar__icon-btn"
            onClick={onToggleSidebar}
            aria-label="Toggle thumbnails"
            title="Toggle thumbnails"
          >
            ☰
          </button>
        )}
        <span className="toolbar__brand">DocuSync</span>
        <span className="toolbar__seal" title="Your files are opened and edited in this browser. Nothing is uploaded.">
          <svg className="toolbar__seal-icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="toolbar__seal-text">On this device · nothing uploaded</span>
        </span>
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
        <MenuButton
          className="toolbar__menu"
          label={
            <>
              File <span aria-hidden="true">▾</span>
            </>
          }
          ariaLabel="File"
          items={fileItems}
          align="end"
        />
        {hasDocument && (
          <div className="toolbar__split">
            <button
              type="button"
              className="toolbar__btn toolbar__split-main"
              // Say so before exporting if redacted pages become images, or
              // if the original had a password this export won't have.
              onClick={handleExport}
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
            <MenuButton
              className="toolbar__split-more"
              label={<span aria-hidden="true">▾</span>}
              ariaLabel="More export options"
              title="More export options"
              items={exportItems}
              align="end"
            />
          </div>
        )}
        <ThemeToggle />
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
        <ExtractPagesDialog onClose={() => setExtractOpen(false)} />
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
          title={
            redactedPages.length
              ? 'Export with redactions?'
              : missingNote
                ? 'Some characters won’t export'
                : 'Export without a password?'
          }
          // Each warning is its own note; the password offer carries its button.
          confirmLabel="Export PDF"
          onConfirm={() => {
            setExportConfirm(false);
            exportDocument();
          }}
          onCancel={() => setExportConfirm(false)}
        >
          {redactedPages.length > 0 && (
            <p className="confirm-dialog__warning" role="note">
              {redactionWarning(redactedPages.length)}
            </p>
          )}
          {missingNote && (
            <p className="confirm-dialog__warning" role="note">
              {missingNote}
            </p>
          )}
          {hadPassword && (
            <ProtectOffer
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

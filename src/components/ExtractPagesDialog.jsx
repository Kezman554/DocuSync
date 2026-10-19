import { useId, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { formatPageRanges, parsePageRanges } from '../lib/pageRanges.js';
import { redactionWarning } from '../lib/redaction.js';
import { DEFAULT_PROTECTION, protectionError } from '../lib/protect.js';
import PasswordFields from './PasswordFields.jsx';
import ProtectOffer from './ProtectOffer.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

const STAGE_LABELS = {
  loading: 'Loading encryption…',
  working: 'Encrypting…',
};

/**
 * Split: choose pages/ranges and download them as a new PDF. Pre-filled with
 * the current sidebar selection (or the current page). Optionally password
 * protects just those pages, encrypting as the last step.
 */
function ExtractPagesDialog({ onClose }) {
  const {
    pages,
    selected,
    currentPage,
    extractPages,
    redactedPages,
    hadPassword,
    dropsFieldsFor,
  } = useDocumentContext();
  const inputId = useId();
  const hintId = useId();

  const [value, setValue] = useState(() => {
    const positions = pages.flatMap((p, i) => (selected.has(p.id) ? [i + 1] : []));
    return formatPageRanges(positions.length ? positions : [currentPage]);
  });
  const [protect, setProtect] = useState(false);
  const [protection, setProtection] = useState(DEFAULT_PROTECTION);
  const [stage, setStage] = useState(null); // null | 'building' | 'loading' | 'working'
  const working = stage !== null;

  const result = parsePageRanges(value, pages.length);
  const count = result.pages?.length ?? 0;
  const redactedCount = result.pages?.filter((n) => redactedPages.includes(n)).length ?? 0;
  const protectionInvalid = protect && Boolean(protectionError(protection));

  const submit = async () => {
    if (!result.pages || protectionInvalid || working) return;
    if (!protect) {
      onClose();
      extractPages(result.pages);
      return;
    }
    // Encrypting takes a moment: stay open to show it; the toolbar explains a failure.
    setStage('building');
    const ok = await extractPages(result.pages, { protection, onStage: setStage });
    setStage(null);
    if (ok) onClose();
  };

  const extractLabel = count > 1 ? `Extract ${count} pages` : 'Extract page';
  return (
    <ConfirmDialog
      role="dialog"
      className={protect ? 'protect-dialog' : ''}
      title="Extract pages"
      message="Save the chosen pages as a new PDF. Page numbers are as shown in the sidebar, and any rotation is kept."
      confirmLabel={working ? STAGE_LABELS[stage] ?? 'Exporting…' : extractLabel}
      confirmDisabled={!result.pages || protectionInvalid || working}
      focusCancel={false}
      onConfirm={submit}
      onCancel={working ? () => {} : onClose}
    >
      <div className="confirm-dialog__field">
        <label htmlFor={inputId} className="confirm-dialog__label">
          Pages (e.g. 1-3, 5, 8-)
        </label>
        <input
          id={inputId}
          className="confirm-dialog__input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          onFocus={(event) => event.target.select()}
          aria-invalid={!result.pages}
          aria-describedby={hintId}
          autoComplete="off"
          spellCheck={false}
          disabled={working}
          autoFocus
        />
        <span
          id={hintId}
          className={`confirm-dialog__hint${
            result.error ? ' confirm-dialog__hint--error' : ''
          }`}
          aria-live="polite"
        >
          {result.error ??
            `${count} of ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}: ${formatPageRanges(result.pages)}`}
        </span>
        <label className="confirm-dialog__option">
          <input
            type="checkbox"
            checked={protect}
            onChange={(event) => setProtect(event.target.checked)}
            disabled={working}
          />
          Password protect
          <span className="confirm-dialog__option-note">AES-256, these pages only</span>
        </label>
      </div>
      {protect && (
        <PasswordFields value={protection} onChange={setProtection} disabled={working} />
      )}
      {result.pages && dropsFieldsFor(result.pages) && (
        <p className="confirm-dialog__warning" role="note">
          A form field on the chosen pages also appears on pages left out, so it won’t be
          included.
        </p>
      )}
      {redactedCount > 0 && (
        <p className="confirm-dialog__warning" role="note">
          {redactionWarning(redactedCount)}
        </p>
      )}
      {hadPassword && !protect && <ProtectOffer />}
    </ConfirmDialog>
  );
}

export default ExtractPagesDialog;

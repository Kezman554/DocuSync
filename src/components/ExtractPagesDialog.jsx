import { useId, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { formatPageRanges, parsePageRanges } from '../lib/pageRanges.js';
import { redactionWarning } from '../lib/redaction.js';
import ProtectOffer from './ProtectOffer.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

/**
 * Split: choose pages/ranges and download them as a new PDF. Pre-filled with
 * the current sidebar selection (or the current page).
 */
function ExtractPagesDialog({ onClose, onProtect }) {
  const { pages, selected, currentPage, extractPages, redactedPages, hadPassword } =
    useDocumentContext();
  const inputId = useId();
  const hintId = useId();

  const [value, setValue] = useState(() => {
    const positions = pages.flatMap((p, i) => (selected.has(p.id) ? [i + 1] : []));
    return formatPageRanges(positions.length ? positions : [currentPage]);
  });

  const result = parsePageRanges(value, pages.length);
  const count = result.pages?.length ?? 0;
  const redactedCount = result.pages?.filter((n) => redactedPages.includes(n)).length ?? 0;

  const submit = () => {
    if (!result.pages) return;
    onClose();
    extractPages(result.pages);
  };

  return (
    <ConfirmDialog
      role="dialog"
      title="Extract pages"
      message="Save the chosen pages as a new PDF. Page numbers are as shown in the sidebar, and any rotation is kept."
      confirmLabel={count > 1 ? `Extract ${count} pages` : 'Extract page'}
      confirmDisabled={!result.pages}
      focusCancel={false}
      onConfirm={submit}
      onCancel={onClose}
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
      </div>
      {redactedCount > 0 && (
        <p className="confirm-dialog__warning" role="note">
          {redactionWarning(redactedCount)}
        </p>
      )}
      {hadPassword && <ProtectOffer onProtect={onProtect} />}
    </ConfirmDialog>
  );
}

export default ExtractPagesDialog;

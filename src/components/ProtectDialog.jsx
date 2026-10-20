import { useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { DEFAULT_PROTECTION, protectionError } from '../lib/protect.js';
import { redactionWarning } from '../lib/redaction.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import PasswordFields from './PasswordFields.jsx';

const STAGE_LABELS = {
  loading: 'Loading encryption…',
  working: 'Encrypting…',
};

/**
 * Export with password: the normal export, then AES-256 encryption as the
 * last step (lib/protect.js, in a worker). Passwords live only in this
 * dialog and are gone when it closes.
 */
function ProtectDialog({ onClose }) {
  const { exportProtected, redactedPages, missingCharsNote, numPages } = useDocumentContext();
  const missingNote = missingCharsNote(Array.from({ length: numPages }, (_, i) => i + 1));
  const [protection, setProtection] = useState(DEFAULT_PROTECTION);
  const [stage, setStage] = useState(null); // null | 'building' | 'loading' | 'working'
  const working = stage !== null;

  const submit = async () => {
    if (protectionError(protection) || working) return;
    setStage('building');
    const ok = await exportProtected(protection, setStage);
    setStage(null);
    if (ok) onClose(); // on failure the toolbar says why; keep the dialog
  };

  return (
    <ConfirmDialog
      role="dialog"
      className="protect-dialog"
      title="Export with password"
      message="Download the edited PDF encrypted with AES-256. Nothing leaves your device."
      confirmLabel={working ? STAGE_LABELS[stage] ?? 'Exporting…' : 'Export protected PDF'}
      confirmDisabled={Boolean(protectionError(protection)) || working}
      focusCancel={false}
      onConfirm={submit}
      onCancel={working ? () => {} : onClose}
    >
      <PasswordFields value={protection} onChange={setProtection} disabled={working} autoFocus />
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
      <span className="password-fields__status" role="status" aria-live="polite">
        {working ? STAGE_LABELS[stage] ?? 'Building the PDF…' : ''}
      </span>
    </ConfirmDialog>
  );
}

export default ProtectDialog;

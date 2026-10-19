import { useId, useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { WrongPasswordError } from '../lib/protect.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import './PasswordPromptDialog.css';

const STAGE_LABELS = {
  loading: 'Loading decryption…',
  working: 'Decrypting…',
};

/**
 * Asks before an encrypted file is unlocked on open. kind 'open': its
 * password (the open or the owner password). kind 'owner' (only an owner
 * password restricts it): the owner password, or confirmation the user has
 * the right to edit it. A wrong password says so and asks again; Cancel
 * leaves the file unopened.
 */
function PasswordPrompt({ request }) {
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [stage, setStage] = useState(null);
  const working = stage !== null;
  const owner = request.kind === 'owner';

  const submit = async () => {
    if (!password || working) return;
    setError(null);
    setStage('loading');
    try {
      await request.attempt(password, setStage); // closes the dialog on success
    } catch (err) {
      setStage(null);
      setError(
        err instanceof WrongPasswordError
          ? 'That password didn’t work. Check it and try again.'
          : `Couldn’t unlock the file${err?.message ? `: ${err.message}` : '.'}`
      );
      setPassword('');
      inputRef.current?.focus();
    }
  };

  return (
    <ConfirmDialog
      role="dialog"
      title={owner ? 'Restricted PDF' : 'Password needed'}
      message={
        owner
          ? `“${request.name}” has restrictions on printing, copying or editing set by its owner. Enter the owner password to remove them, or confirm you may edit it — it’s unlocked on this device only.`
          : `“${request.name}” is password-protected. Enter its password to view and edit it — it’s decrypted on this device only.`
      }
      confirmLabel={working ? STAGE_LABELS[stage] : 'Unlock'}
      confirmDisabled={!password || working}
      focusCancel={false}
      onConfirm={submit}
      onCancel={working ? () => {} : request.cancel}
    >
      <div className="confirm-dialog__field">
        <label htmlFor={inputId} className="confirm-dialog__label">
          {owner ? 'Owner password' : 'Password'}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="password"
          className="confirm-dialog__input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={hintId}
          autoComplete="current-password"
          disabled={working}
          autoFocus
        />
        <span
          id={hintId}
          className={`confirm-dialog__hint${error ? ' confirm-dialog__hint--error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {error ?? (working ? STAGE_LABELS[stage] : '')}
        </span>
      </div>
      {owner && (
        <button
          type="button"
          className="password-prompt__without"
          onClick={request.confirmRight}
          disabled={working}
        >
          I don’t have the owner password, and I have the right to edit this file
        </button>
      )}
    </ConfirmDialog>
  );
}

/** Shows the prompt whenever an opened file is waiting for its password. */
function PasswordPromptDialog() {
  const { passwordRequest } = useDocumentContext();
  // Keyed by request so each file starts with an empty field.
  return passwordRequest ? (
    <PasswordPrompt key={passwordRequest.id} request={passwordRequest} />
  ) : null;
}

export default PasswordPromptDialog;

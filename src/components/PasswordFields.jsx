import { useId } from 'react';
import { SHORT_PASSWORD, hasOwnerPassword, protectionError } from '../lib/protect.js';
import './PasswordFields.css';

/**
 * Password-protection settings for an export (see lib/protect.js): open
 * password (typed twice), optional owner password, and print/copy/edit
 * permissions — which only apply with an owner password. Controlled:
 * `value` is the settings object, `onChange` receives the next one.
 */
function PasswordFields({ value, onChange, disabled = false, autoFocus = false }) {
  const id = useId();
  const set = (patch) => onChange({ ...value, ...patch });
  const error = protectionError(value);
  const typed = value.openPassword || value.repeatPassword;
  const restricted = hasOwnerPassword(value);
  const short = value.openPassword && value.openPassword.length < SHORT_PASSWORD;

  return (
    <div className="password-fields">
      <div className="confirm-dialog__field password-fields__field">
        <label htmlFor={`${id}-open`} className="confirm-dialog__label">
          Password to open the file
        </label>
        <input
          id={`${id}-open`}
          type="password"
          className="confirm-dialog__input"
          value={value.openPassword}
          onChange={(event) => set({ openPassword: event.target.value })}
          autoComplete="new-password"
          disabled={disabled}
          autoFocus={autoFocus}
          aria-describedby={`${id}-short`}
        />
        <span id={`${id}-short`} className="confirm-dialog__hint" aria-live="polite">
          {short ? `Short passwords can be guessed — ${SHORT_PASSWORD}+ characters is safer.` : ''}
        </span>
        <label htmlFor={`${id}-repeat`} className="confirm-dialog__label">
          Type it again
        </label>
        <input
          id={`${id}-repeat`}
          type="password"
          className="confirm-dialog__input"
          value={value.repeatPassword}
          onChange={(event) => set({ repeatPassword: event.target.value })}
          autoComplete="new-password"
          disabled={disabled}
          aria-invalid={Boolean(value.repeatPassword) && value.repeatPassword !== value.openPassword}
          aria-describedby={`${id}-error`}
        />
        <span
          id={`${id}-error`}
          className={`confirm-dialog__hint${typed && error ? ' confirm-dialog__hint--error' : ''}`}
          aria-live="polite"
        >
          {typed ? error ?? '' : ''}
        </span>
      </div>

      <div className="confirm-dialog__field password-fields__field">
        <label htmlFor={`${id}-owner`} className="confirm-dialog__label">
          Owner password (optional, for restrictions)
        </label>
        <input
          id={`${id}-owner`}
          type="password"
          className="confirm-dialog__input"
          value={value.ownerPassword}
          onChange={(event) => set({ ownerPassword: event.target.value })}
          autoComplete="new-password"
          disabled={disabled}
        />
        <fieldset className="confirm-dialog__options" disabled={disabled || !restricted}>
          <legend className="confirm-dialog__label">
            {restricted
              ? 'Allow people who open it to:'
              : 'Add an owner password (different from the one above) to limit:'}
          </legend>
          {[
            ['allowPrinting', 'Print'],
            ['allowCopying', 'Copy text and images'],
            ['allowEditing', 'Edit'],
          ].map(([key, label]) => (
            <label key={key} className="confirm-dialog__option">
              <input
                type="checkbox"
                checked={value[key]}
                onChange={(event) => set({ [key]: event.target.checked })}
              />
              {label}
            </label>
          ))}
        </fieldset>
      </div>

      <p className="password-fields__note" role="note">
        Print, copy and edit limits are only obeyed by reader apps that choose to respect them.
        A forgotten password can’t be recovered, and a short one can be guessed.
      </p>
    </div>
  );
}

export default PasswordFields;

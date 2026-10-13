import { useEffect, useId, useRef } from 'react';
import './ConfirmDialog.css';

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Modal confirmation. Focus starts on Cancel (the safe choice) unless
 * `focusCancel` is false (e.g. when `children` holds an autoFocus input).
 * Tab is trapped inside, and Escape or a backdrop click cancels.
 * `cancelLabel={null}` leaves out the Cancel button (e.g. a final "Done").
 */
function ConfirmDialog({
  title,
  message,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmDisabled = false,
  destructive = false,
  role = 'alertdialog',
  focusCancel = true,
  className = '',
  onConfirm,
  onCancel,
}) {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    if (focusCancel) cancelRef.current?.focus();
    return () => previouslyFocused?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
    } else if (event.key === 'Tab') {
      const items = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE));
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement);
      const step = event.shiftKey ? -1 : 1;
      event.preventDefault();
      items[(index + step + items.length) % items.length].focus();
    }
  };

  return (
    <div
      className="confirm-dialog__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className={`confirm-dialog${className ? ` ${className}` : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="confirm-dialog__title">
          {title}
        </h2>
        <p id={messageId} className="confirm-dialog__message">
          {message}
        </p>
        {children}
        <div className="confirm-dialog__actions">
          {cancelLabel !== null && (
            <button
              ref={cancelRef}
              type="button"
              className="confirm-dialog__btn"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={`confirm-dialog__btn confirm-dialog__btn--primary${
              destructive ? ' confirm-dialog__btn--danger' : ''
            }`}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;

import './ProtectOffer.css';

export const UNPROTECTED_SENTENCE =
  'The original was password-protected, but this new file won’t be.';

/**
 * Said before a plain export when a loaded file had a password: one
 * sentence (unless the surrounding dialog already says it) and, with
 * `onProtect`, a way to Export with password instead — left out where the
 * dialog has its own "Password protect" option. Never blocks the plain export.
 */
function ProtectOffer({ onProtect, sentence = true }) {
  return (
    <p className="protect-offer" role="note">
      {sentence && <span>{UNPROTECTED_SENTENCE} </span>}
      {onProtect && (
        <button type="button" className="protect-offer__btn" onClick={onProtect}>
          Export with password…
        </button>
      )}
    </p>
  );
}

export default ProtectOffer;

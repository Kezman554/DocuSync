import { useId, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import {
  DEFAULT_NUMBERING,
  NUMBER_FORMATS,
  NUMBER_POSITIONS,
  formatPageNumber,
  pageNumberLabels,
} from '../lib/pageNumbering.js';
import { STANDARD_FONTS } from '../lib/textLayout.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import './PageNumbersDialog.css';


const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24];
const POSITION_LABELS = {
  'top-left': 'Top left',
  'top-center': 'Top centre',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-center': 'Bottom centre',
  'bottom-right': 'Bottom right',
};

/**
 * Configure page numbers for the whole document: position, format, start
 * number, first-page skip, font and size. Numbers follow page positions, so
 * they stay right through reordering, deleting and merging.
 */
function PageNumbersDialog({ onClose }) {
  const { numbering, setNumbering, numPages, typingWarning } = useDocumentContext();
  const ids = { format: useId(), start: useId(), font: useId(), size: useId(), skip: useId() };
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_NUMBERING, ...numbering }));
  const set = (patch) => setDraft((prev) => ({ ...prev, ...patch }));

  const startValid = Number.isInteger(draft.start) && draft.start >= 0 && draft.start <= 99999;
  const labels = startValid ? pageNumberLabels(numPages, draft) : [];
  const firstShown = labels.find(Boolean);
  // Every format exports in every font today; this keeps it that way if one
  // is added that doesn't.
  const missing = typingWarning(labels.filter(Boolean).join(' '), draft.font);
  const total = draft.start + numPages - 1;

  const apply = () => {
    if (!startValid) return;
    setNumbering(draft);
    onClose();
  };

  return (
    <ConfirmDialog
      role="dialog"
      title="Page numbers"
      message="Numbers are added to every page when you export, placed relative to how each page is shown."
      confirmLabel={numbering ? 'Update numbers' : 'Add page numbers'}
      confirmDisabled={!startValid}
      focusCancel={false}
      onConfirm={apply}
      onCancel={onClose}
    >
      <div className="page-numbers">
        <fieldset className="page-numbers__positions">
          <legend className="confirm-dialog__label">Position</legend>
          {NUMBER_POSITIONS.map((position) => (
            <label
              key={position}
              className={`page-numbers__position page-numbers__position--${position}${
                draft.position === position ? ' page-numbers__position--on' : ''
              }`}
              title={POSITION_LABELS[position]}
            >
              <input
                type="radio"
                name="number-position"
                value={position}
                checked={draft.position === position}
                onChange={() => set({ position })}
                aria-label={POSITION_LABELS[position]}
              />
              <span className="page-numbers__dot" aria-hidden="true" />
            </label>
          ))}
        </fieldset>

        <div className="page-numbers__fields">
          <label className="confirm-dialog__label" htmlFor={ids.format}>
            Format
            <select
              id={ids.format}
              className="confirm-dialog__input"
              value={draft.format}
              onChange={(event) => set({ format: event.target.value })}
            >
              {NUMBER_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {formatPageNumber(f.id, Math.max(draft.start, 0) || 1, total > 0 ? total : numPages)}
                </option>
              ))}
            </select>
          </label>
          <label className="confirm-dialog__label" htmlFor={ids.start}>
            Start at
            <input
              id={ids.start}
              className="confirm-dialog__input"
              type="number"
              min={0}
              max={99999}
              step={1}
              value={Number.isNaN(draft.start) ? '' : draft.start}
              onChange={(event) => set({ start: event.target.value === '' ? NaN : Number(event.target.value) })}
              aria-invalid={!startValid}
            />
          </label>
          <label className="confirm-dialog__label" htmlFor={ids.font}>
            Font
            <select
              id={ids.font}
              className="confirm-dialog__input"
              value={draft.font}
              onChange={(event) => set({ font: event.target.value })}
            >
              {Object.entries(STANDARD_FONTS)
                .filter(([, f]) => !f.symbols)
                .map(([key, f]) => (
                  <option key={key} value={key}>
                    {f.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="confirm-dialog__label" htmlFor={ids.size}>
            Size
            <select
              id={ids.size}
              className="confirm-dialog__input"
              value={draft.fontSize}
              onChange={(event) => set({ fontSize: Number(event.target.value) })}
            >
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} pt
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="page-numbers__check" htmlFor={ids.skip}>
          <input
            id={ids.skip}
            type="checkbox"
            checked={draft.skipFirst}
            onChange={(event) => set({ skipFirst: event.target.checked })}
          />
          Don’t number the first page (cover)
        </label>

        <p className="confirm-dialog__hint confirm-dialog__hint--warn" role="status">
          {missing}
        </p>
        <p className="confirm-dialog__hint" aria-live="polite">
          {startValid
            ? `${POSITION_LABELS[draft.position]}: “${firstShown ?? '—'}”${
                draft.skipFirst ? ' on page 2' : ' on page 1'
              }, to “${labels[labels.length - 1]}” on page ${numPages}.`
            : 'Start at a whole number from 0 to 99999.'}
        </p>

        {numbering && (
          <button
            type="button"
            className="confirm-dialog__btn page-numbers__remove"
            onClick={() => {
              setNumbering(null);
              onClose();
            }}
          >
            Remove page numbers
          </button>
        )}
      </div>
    </ConfirmDialog>
  );
}

export default PageNumbersDialog;

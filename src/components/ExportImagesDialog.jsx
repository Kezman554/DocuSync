import { useId, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { formatPageRanges, parsePageRanges } from '../lib/pageRanges.js';
import { DEFAULT_DPI, IMAGE_FORMATS, RESOLUTIONS } from '../lib/imageExport.js';
import ConfirmDialog from './ConfirmDialog.jsx';

/**
 * PDF → images: choose pages, PNG or JPG, and resolution. Images show the
 * pages as exported (order, rotation, annotations). Pre-filled with the
 * sidebar selection (or the current page).
 */
function ExportImagesDialog({ onClose }) {
  const { pages, selected, currentPage, exportImages, missingCharsNote } = useDocumentContext();
  const ids = { pages: useId(), hint: useId(), dpi: useId() };
  const [value, setValue] = useState(() => {
    const positions = pages.flatMap((p, i) => (selected.has(p.id) ? [i + 1] : []));
    return formatPageRanges(positions.length ? positions : [currentPage]);
  });
  const [format, setFormat] = useState('png');
  const [dpi, setDpi] = useState(DEFAULT_DPI);

  const result = parsePageRanges(value, pages.length);
  const count = result.pages?.length ?? 0;
  const { label } = IMAGE_FORMATS[format];
  const missingNote =
    result.pages && missingCharsNote(result.pages, 'the exported images');
  const summary =
    count === 1
      ? `1 page → one ${label} image`
      : `${count} pages → a ZIP of ${count} ${label} images`;

  const submit = () => {
    if (!result.pages) return;
    onClose();
    exportImages(result.pages, { format, dpi });
  };

  return (
    <ConfirmDialog
      role="dialog"
      title="Export pages as images"
      message="Each page is saved as it would appear in an exported PDF, including rotation and anything you’ve added."
      confirmLabel={count > 1 ? `Export ${count} images` : 'Export image'}
      confirmDisabled={!result.pages}
      focusCancel={false}
      onConfirm={submit}
      onCancel={onClose}
    >
      <div className="confirm-dialog__field">
        <label htmlFor={ids.pages} className="confirm-dialog__label">
          Pages (e.g. 1-3, 5, 8-)
        </label>
        <input
          id={ids.pages}
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
          aria-describedby={ids.hint}
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <span
          id={ids.hint}
          className={`confirm-dialog__hint${result.error ? ' confirm-dialog__hint--error' : ''}`}
          aria-live="polite"
        >
          {result.error ?? summary}
        </span>

        <fieldset className="confirm-dialog__options">
          <legend className="confirm-dialog__label">Format</legend>
          {Object.values(IMAGE_FORMATS).map((f) => (
            <label key={f.id} className="confirm-dialog__option">
              <input
                type="radio"
                name="image-format"
                value={f.id}
                checked={format === f.id}
                onChange={() => setFormat(f.id)}
              />
              {f.label}
              <span className="confirm-dialog__option-note">
                {f.id === 'png' ? 'sharp text, larger files' : 'smaller files, good for photos'}
              </span>
            </label>
          ))}
        </fieldset>

        <label htmlFor={ids.dpi} className="confirm-dialog__label">
          Resolution
        </label>
        <select
          id={ids.dpi}
          className="confirm-dialog__input"
          value={dpi}
          onChange={(event) => setDpi(Number(event.target.value))}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r.dpi} value={r.dpi}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      {missingNote && (
        <p className="confirm-dialog__warning" role="note">
          {missingNote}
        </p>
      )}
    </ConfirmDialog>
  );
}

export default ExportImagesDialog;

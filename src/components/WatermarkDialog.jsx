import { useId, useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { DEFAULT_WATERMARK, watermarkApplies } from '../lib/watermark.js';
import { STANDARD_FONTS } from '../lib/textLayout.js';
import { sniffImage } from '../lib/imageInfo.js';
import { newAnnotationId } from '../lib/annotations.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import './WatermarkDialog.css';

const ANGLES = [0, 45, -45, 90];
const SIZES = ['auto', 24, 36, 48, 72, 96, 144];

/**
 * Configure a document watermark: text or image, opacity, angle and which
 * pages. Applied to every export, previewed on the page.
 */
function WatermarkDialog({ onClose }) {
  const { watermark, setWatermark, numPages, typingWarning } = useDocumentContext();
  const ids = {
    text: useId(),
    textWarning: useId(),
    font: useId(),
    size: useId(),
    colour: useId(),
    opacity: useId(),
    angle: useId(),
    scale: useId(),
    pages: useId(),
  };
  const fileRef = useRef(null);
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_WATERMARK, ...watermark }));
  const [pagesMode, setPagesMode] = useState(draft.pages === 'all' ? 'all' : 'some');
  const [pagesText, setPagesText] = useState(draft.pages === 'all' ? '' : draft.pages);
  const [imageError, setImageError] = useState(null);
  const set = (patch) => setDraft((prev) => ({ ...prev, ...patch }));

  const pages = pagesMode === 'all' ? 'all' : pagesText.trim();
  const applies = watermarkApplies(pages, numPages);
  const count = applies.filter(Boolean).length;
  const angleValid = Number.isFinite(draft.angle) && Math.abs(draft.angle) <= 180;
  const contentValid = draft.type === 'image' ? Boolean(draft.image) : Boolean(draft.text.trim());
  const valid = contentValid && angleValid && count > 0;

  const chooseImage = async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = sniffImage(bytes);
    if (!info) {
      setImageError(`“${file.name}” isn’t a PNG or JPG image.`);
      return;
    }
    setImageError(null);
    const url =
      typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(new Blob([bytes], { type: info.mime }))
        : undefined;
    set({ image: { id: `wm-${newAnnotationId()}`, name: file.name, bytes, url, ...info } });
  };

  const apply = () => {
    if (!valid) return;
    setWatermark({ ...draft, pages });
    onClose();
  };

  return (
    <ConfirmDialog
      role="dialog"
      title="Watermark"
      message="A see-through mark across your pages, added when you export."
      confirmLabel={watermark ? 'Update watermark' : 'Add watermark'}
      confirmDisabled={!valid}
      focusCancel={false}
      onConfirm={apply}
      onCancel={onClose}
    >
      <div className="watermark">
        <fieldset className="watermark__type">
          <legend className="confirm-dialog__label">Type</legend>
          {['text', 'image'].map((type) => (
            <label key={type} className="confirm-dialog__option">
              <input
                type="radio"
                name="watermark-type"
                value={type}
                checked={draft.type === type}
                onChange={() => set({ type })}
              />
              {type === 'text' ? 'Text' : 'Image'}
            </label>
          ))}
        </fieldset>

        {draft.type === 'text' ? (
          <div className="watermark__grid">
            <label className="confirm-dialog__label watermark__wide" htmlFor={ids.text}>
              Watermark text
              <input
                id={ids.text}
                className="confirm-dialog__input"
                value={draft.text}
                maxLength={60}
                onChange={(event) => set({ text: event.target.value })}
                aria-describedby={ids.textWarning}
              />
            </label>
            <span
              id={ids.textWarning}
              className="confirm-dialog__hint confirm-dialog__hint--warn watermark__wide"
              role="status"
            >
              {typingWarning(draft.text, draft.font)}
            </span>
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
                onChange={(event) =>
                  set({ fontSize: event.target.value === 'auto' ? 'auto' : Number(event.target.value) })
                }
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s === 'auto' ? 'Fit the page' : `${s} pt`}
                  </option>
                ))}
              </select>
            </label>
            <label className="confirm-dialog__label" htmlFor={ids.colour}>
              Colour
              <input
                id={ids.colour}
                type="color"
                className="watermark__colour"
                value={draft.color}
                onChange={(event) => set({ color: event.target.value })}
              />
            </label>
          </div>
        ) : (
          <div className="watermark__image">
            <button type="button" className="confirm-dialog__btn" onClick={() => fileRef.current?.click()}>
              {draft.image ? 'Change image…' : 'Choose image…'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              hidden
              aria-label="Watermark image"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) chooseImage(file);
              }}
            />
            {draft.image && (
              <span className="watermark__image-name">
                {draft.image.name} ({draft.image.width} × {draft.image.height})
              </span>
            )}
            {imageError && (
              <p className="confirm-dialog__hint confirm-dialog__hint--error" role="alert">
                {imageError}
              </p>
            )}
            <label className="confirm-dialog__label" htmlFor={ids.scale}>
              Size: {Math.round(draft.imageScale * 100)}% of the page width
              <input
                id={ids.scale}
                type="range"
                min={10}
                max={100}
                step={5}
                value={Math.round(draft.imageScale * 100)}
                onChange={(event) => set({ imageScale: Number(event.target.value) / 100 })}
              />
            </label>
          </div>
        )}

        <label className="confirm-dialog__label" htmlFor={ids.opacity}>
          Opacity: {Math.round(draft.opacity * 100)}%
          <input
            id={ids.opacity}
            type="range"
            min={5}
            max={100}
            step={5}
            value={Math.round(draft.opacity * 100)}
            onChange={(event) => set({ opacity: Number(event.target.value) / 100 })}
          />
        </label>

        <div className="watermark__angle">
          <label className="confirm-dialog__label" htmlFor={ids.angle}>
            Angle (°)
            <input
              id={ids.angle}
              type="number"
              className="confirm-dialog__input"
              min={-180}
              max={180}
              step={1}
              value={Number.isFinite(draft.angle) ? draft.angle : ''}
              onChange={(event) => set({ angle: event.target.value === '' ? NaN : Number(event.target.value) })}
              aria-invalid={!angleValid}
            />
          </label>
          <span className="watermark__presets" role="group" aria-label="Angle presets">
            {ANGLES.map((a) => (
              <button
                key={a}
                type="button"
                className={`confirm-dialog__btn${draft.angle === a ? ' watermark__preset--on' : ''}`}
                onClick={() => set({ angle: a })}
                aria-pressed={draft.angle === a}
              >
                {a}°
              </button>
            ))}
          </span>
        </div>

        <fieldset className="watermark__pages">
          <legend className="confirm-dialog__label">Pages</legend>
          <label className="confirm-dialog__option">
            <input
              type="radio"
              name="watermark-pages"
              checked={pagesMode === 'all'}
              onChange={() => setPagesMode('all')}
            />
            All pages
          </label>
          <label className="confirm-dialog__option">
            <input
              type="radio"
              name="watermark-pages"
              checked={pagesMode === 'some'}
              onChange={() => setPagesMode('some')}
            />
            Only pages
            <input
              id={ids.pages}
              className="confirm-dialog__input watermark__pages-input"
              value={pagesText}
              placeholder="e.g. 2-5, 8"
              aria-label="Watermark pages"
              onFocus={() => setPagesMode('some')}
              onChange={(event) => setPagesText(event.target.value)}
            />
          </label>
        </fieldset>
        <p className="confirm-dialog__hint" aria-live="polite">
          {count > 0
            ? `On ${count} of ${numPages} ${numPages === 1 ? 'page' : 'pages'}.`
            : 'Choose at least one page.'}
        </p>

        {watermark && (
          <button
            type="button"
            className="confirm-dialog__btn"
            onClick={() => {
              setWatermark(null);
              onClose();
            }}
          >
            Remove watermark
          </button>
        )}
      </div>
    </ConfirmDialog>
  );
}

export default WatermarkDialog;

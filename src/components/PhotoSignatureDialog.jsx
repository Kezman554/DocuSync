import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { DEFAULTS, photoToSignature } from '../lib/photoSignature.js';
import { decodePhoto, encodePng, paintPixels } from '../lib/photoSignatureBrowser.js';
import { PEN_COLOURS } from '../lib/signature.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import './SignatureDialog.css';
import './PhotoSignatureDialog.css';

/** Ink-detection levels, faint-to-strong pickup → threshold sensitivity. */
const LEVELS = [0.3, 0.26, 0.22, 0.18, 0.15, 0.12, 0.1, 0.08, 0.06];
const DEFAULT_LEVEL = LEVELS.indexOf(DEFAULTS.sensitivity) + 1; // 5 of 9

const INK_MODES = [{ id: 'photo', label: 'As photographed', value: null }].concat(
  PEN_COLOURS.map((c) => ({ id: c.id, label: c.label, value: c.value }))
);

/**
 * Turn a photo of an ink signature into a transparent stamp: preview the
 * cleaned-up result live, tweak detection, then save via
 * `onSave(bytes, name)`.
 */
function PhotoSignatureDialog({ file, onSave, onCancel }) {
  const ids = { level: useId(), name: useId(), edge: useId() };
  const sourceCanvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const [photo, setPhoto] = useState(null); // decoded RGBA
  const [loadError, setLoadError] = useState(null);
  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [inkMode, setInkMode] = useState('photo');
  const [dropEdgeMarks, setDropEdgeMarks] = useState(true);
  const [name, setName] = useState(() => file.name.replace(/\.[^.]+$/, '') || 'Signature');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    decodePhoto(file)
      .then((pixels) => !cancelled && setPhoto(pixels))
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [file]);

  const result = useMemo(
    () =>
      photo &&
      photoToSignature(photo, {
        sensitivity: LEVELS[level - 1],
        dropEdgeMarks,
        inkColour: INK_MODES.find((m) => m.id === inkMode)?.value ?? null,
      }),
    [photo, level, dropEdgeMarks, inkMode]
  );

  // Show the original and the transparent result.
  useEffect(() => {
    if (photo && sourceCanvasRef.current) paintPixels(sourceCanvasRef.current, photo);
  }, [photo]);
  useEffect(() => {
    if (result && previewCanvasRef.current) paintPixels(previewCanvasRef.current, result);
  }, [result]);

  const save = async () => {
    if (!result || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(await encodePng(result), name);
    } catch (err) {
      setSaveError(err.message);
      setSaving(false);
    }
  };

  let status;
  if (loadError) status = loadError;
  else if (!photo) status = 'Reading photo…';
  else if (!result) status = 'No ink found. Try picking up fainter ink, or a closer photo.';

  return (
    <ConfirmDialog
      role="dialog"
      className="confirm-dialog--wide"
      title="Signature from a photo"
      message="Photograph your signature on plain paper in good light. The paper is made transparent and the ink is cropped."
      confirmLabel={saving ? 'Saving…' : 'Save signature'}
      confirmDisabled={!result || saving}
      focusCancel={false}
      onConfirm={save}
      onCancel={onCancel}
    >
      <div className="photo-signature">
        <div className="photo-signature__panes">
          <figure className="photo-signature__pane">
            <figcaption>Photo</figcaption>
            <canvas
              ref={sourceCanvasRef}
              className="photo-signature__canvas"
              hidden={!photo}
              aria-label="Original photo"
            />
          </figure>
          <figure className="photo-signature__pane">
            <figcaption>Result (transparent)</figcaption>
            <div className="photo-signature__checker">
              <canvas
                ref={previewCanvasRef}
                className="photo-signature__canvas"
                hidden={!result}
                aria-label="Signature preview"
              />
            </div>
          </figure>
        </div>
        <p
          className={`photo-signature__status${loadError ? ' photo-signature__status--error' : ''}`}
          role="status"
        >
          {status ?? `Found ink: ${result.width} × ${result.height} px.`}
        </p>

        <div className="photo-signature__controls">
          <label className="confirm-dialog__label" htmlFor={ids.level}>
            Ink detection
          </label>
          <div className="photo-signature__slider">
            <span aria-hidden="true">Less</span>
            <input
              id={ids.level}
              type="range"
              min={1}
              max={LEVELS.length}
              step={1}
              value={level}
              onChange={(event) => setLevel(Number(event.target.value))}
              aria-valuetext={`Level ${level} of ${LEVELS.length}${
                level === DEFAULT_LEVEL ? ' (default)' : ''
              }`}
              disabled={!photo}
            />
            <span aria-hidden="true">More</span>
          </div>

          <label className="photo-signature__check" htmlFor={ids.edge}>
            <input
              id={ids.edge}
              type="checkbox"
              checked={dropEdgeMarks}
              onChange={(event) => setDropEdgeMarks(event.target.checked)}
              disabled={!photo}
            />
            Ignore marks touching the photo’s edge
          </label>

          <fieldset className="photo-signature__ink">
            <legend className="confirm-dialog__label">Ink colour</legend>
            {INK_MODES.map((m) => (
              <label key={m.id} className="photo-signature__ink-option">
                <input
                  type="radio"
                  name="photo-signature-ink"
                  value={m.id}
                  checked={inkMode === m.id}
                  onChange={() => setInkMode(m.id)}
                  disabled={!photo}
                />
                {m.label}
              </label>
            ))}
          </fieldset>

          <label className="confirm-dialog__label" htmlFor={ids.name}>
            Name
          </label>
          <input
            id={ids.name}
            className="confirm-dialog__input photo-signature__name"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
          />
          {saveError && (
            <p className="confirm-dialog__hint confirm-dialog__hint--error" role="alert">
              {saveError}
            </p>
          )}
        </div>
      </div>
    </ConfirmDialog>
  );
}

export default PhotoSignatureDialog;

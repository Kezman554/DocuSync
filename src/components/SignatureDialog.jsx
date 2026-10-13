import { useEffect, useId, useRef, useState } from 'react';
import SignaturePad from 'signature_pad';
import { PEN_COLOURS } from '../lib/signature.js';
import { exportSignaturePng } from '../lib/signatureExport.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import './SignatureDialog.css';

// Fallback pad size where layout isn't available (CSS px).
const PAD_WIDTH = 560;
const PAD_HEIGHT = 200;

/**
 * Draw a signature with mouse, finger or stylus (signature_pad uses pointer
 * events), then save it as a transparent PNG via `onSave(bytes, name)`.
 */
function SignatureDialog({ onSave, onCancel }) {
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  // Render at ≥2× so the exported PNG stays crisp when placed and printed.
  const ratio = Math.max(window.devicePixelRatio || 1, 2);
  const ids = { name: useId(), hint: useId() };
  const [empty, setEmpty] = useState(true);
  const [pen, setPen] = useState(PEN_COLOURS[0].value);
  const [name, setName] = useState('Signature');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const pad = new SignaturePad(canvas, { penColor: pen, minWidth: 0.6, maxWidth: 2.6 });
    padRef.current = pad;

    // Size the backing store to the element (resizing clears it, so redraw).
    const resize = () => {
      const data = pad.toData();
      const width = canvas.offsetWidth || PAD_WIDTH;
      const height = canvas.offsetHeight || PAD_HEIGHT;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.getContext('2d').scale(ratio, ratio);
      pad.clear();
      pad.fromData(data);
    };
    resize();

    const onEnd = () => setEmpty(pad.isEmpty());
    pad.addEventListener('endStroke', onEnd);
    window.addEventListener('resize', resize);
    return () => {
      pad.removeEventListener('endStroke', onEnd);
      window.removeEventListener('resize', resize);
      pad.off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New strokes use the chosen pen; existing strokes keep their colour.
  useEffect(() => {
    if (padRef.current) padRef.current.penColor = pen;
  }, [pen]);

  const undo = () => {
    const pad = padRef.current;
    const data = pad.toData();
    data.pop();
    pad.clear();
    pad.fromData(data);
    setEmpty(pad.isEmpty());
  };

  const clear = () => {
    padRef.current.clear();
    setEmpty(true);
  };

  const save = async () => {
    const pad = padRef.current;
    if (pad.isEmpty() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const bytes = await exportSignaturePng(canvasRef.current, pad.toData(), ratio);
      await onSave(bytes, name);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <ConfirmDialog
      role="dialog"
      className="confirm-dialog--wide"
      title="Draw your signature"
      message="Sign with your mouse, finger or a stylus. It’s saved to your stamps as a transparent image."
      confirmLabel={saving ? 'Saving…' : 'Save signature'}
      confirmDisabled={empty || saving}
      focusCancel={false}
      onConfirm={save}
      onCancel={onCancel}
    >
      <div className="signature-pad">
        <div className="signature-pad__surface">
          <canvas
            ref={canvasRef}
            className="signature-pad__canvas"
            aria-label="Signature drawing area"
            aria-describedby={ids.hint}
          />
          {/* Guide line and prompt are outside the canvas, so not exported. */}
          <span className="signature-pad__line" aria-hidden="true" />
          {empty && (
            <span className="signature-pad__prompt" aria-hidden="true">
              Sign here
            </span>
          )}
        </div>
        <p id={ids.hint} className="signature-pad__hint">
          Can’t draw? Create initials in the Stamps panel instead.
        </p>

        <div className="signature-pad__tools">
          <fieldset className="signature-pad__pens">
            <legend className="signature-pad__legend">Pen</legend>
            {PEN_COLOURS.map((c) => (
              <label
                key={c.id}
                className={`signature-pad__pen${pen === c.value ? ' signature-pad__pen--on' : ''}`}
                title={c.label}
              >
                <input
                  type="radio"
                  name="signature-pen"
                  value={c.value}
                  checked={pen === c.value}
                  onChange={() => setPen(c.value)}
                  aria-label={`${c.label} pen`}
                />
                <span className="signature-pad__swatch" style={{ background: c.value }} />
              </label>
            ))}
          </fieldset>
          <button type="button" className="confirm-dialog__btn" onClick={undo} disabled={empty}>
            Undo
          </button>
          <button type="button" className="confirm-dialog__btn" onClick={clear} disabled={empty}>
            Clear
          </button>
        </div>

        <label className="confirm-dialog__label" htmlFor={ids.name}>
          Name
        </label>
        <input
          id={ids.name}
          className="confirm-dialog__input"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
        />
        {error && (
          <p className="confirm-dialog__hint confirm-dialog__hint--error" role="alert">
            {error}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}

export default SignatureDialog;

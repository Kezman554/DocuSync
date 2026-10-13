import { useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import {
  COMPRESSION_PRESETS,
  DEFAULT_PRESET,
  formatBytes,
  savingPercent,
} from '../lib/compress.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import './CompressDialog.css';

/**
 * Light compression: pick a quality preset and whether to strip metadata,
 * then download a compressed copy of the edited document and see the
 * before/after size.
 */
function CompressDialog({ onClose }) {
  const { compressDocument } = useDocumentContext();
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [stripMetadata, setStripMetadata] = useState(true);
  const [state, setState] = useState('setup'); // setup | working | done
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);

  const submit = async () => {
    setState('working');
    const result = await compressDocument({ preset, stripMetadata }, (done, total) =>
      setProgress({ done, total })
    );
    if (!result) {
      onClose(); // the toolbar shows why
      return;
    }
    setReport(result);
    setState('done');
  };

  if (state === 'done') {
    const saved = savingPercent(report.before, report.after);
    return (
      <ConfirmDialog
        role="dialog"
        title="Compressed copy downloaded"
        message={
          saved > 0
            ? 'Your compressed PDF has been saved.'
            : 'This PDF is already compact, so it was saved without compression.'
        }
        confirmLabel="Done"
        cancelLabel={null}
        focusCancel={false}
        onConfirm={onClose}
        onCancel={onClose}
      >
        <dl className="compress__report" aria-label="File size">
          <div>
            <dt>Before</dt>
            <dd>{formatBytes(report.before)}</dd>
          </div>
          <div>
            <dt>After</dt>
            <dd>{formatBytes(report.after)}</dd>
          </div>
          <div>
            <dt>Saved</dt>
            <dd>{saved > 0 ? `${saved}%` : '—'}</dd>
          </div>
        </dl>
        <p className="compress__detail">
          {report.images === 0
            ? 'No images to re-encode.'
            : `${report.reencoded} of ${report.images} image${
                report.images === 1 ? '' : 's'
              } re-encoded.`}
        </p>
      </ConfirmDialog>
    );
  }

  const working = state === 'working';
  return (
    <ConfirmDialog
      role="dialog"
      title="Compress PDF"
      message="Re-encodes photos and scans as JPEG and removes unused data. Text and drawings stay sharp and selectable."
      confirmLabel={
        working
          ? progress
            ? `Compressing ${progress.done}/${progress.total}…`
            : 'Compressing…'
          : 'Compress & download'
      }
      confirmDisabled={working}
      focusCancel={false}
      onConfirm={submit}
      onCancel={onClose}
    >
      <div className="confirm-dialog__field">
        <fieldset className="confirm-dialog__options" disabled={working}>
          <legend className="confirm-dialog__label">Image quality</legend>
          {Object.values(COMPRESSION_PRESETS).map((p) => (
            <label key={p.id} className="confirm-dialog__option">
              <input
                type="radio"
                name="compress-preset"
                value={p.id}
                checked={preset === p.id}
                onChange={() => setPreset(p.id)}
                autoFocus={p.id === preset}
              />
              {p.label}
              <span className="confirm-dialog__option-note">{p.note}</span>
            </label>
          ))}
        </fieldset>
        <label className="confirm-dialog__option">
          <input
            type="checkbox"
            checked={stripMetadata}
            onChange={(event) => setStripMetadata(event.target.checked)}
            disabled={working}
          />
          Remove metadata
          <span className="confirm-dialog__option-note">title, author, XMP, thumbnails</span>
        </label>
      </div>
    </ConfirmDialog>
  );
}

export default CompressDialog;

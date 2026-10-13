import { useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import {
  COMPRESSION_PRESETS,
  DEFAULT_PRESET,
  explainResult,
  formatBytes,
  savingPercent,
} from '../lib/compress.js';
import { downloadBytes } from '../lib/download.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import './CompressDialog.css';

/**
 * Light compression: pick a quality preset and whether to strip metadata,
 * compress the edited document, see the before/after size (and why, if it
 * didn't help), then choose whether to download the result.
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
    const helped = report.after < report.before;
    const notes = explainResult(report);
    const download = () => {
      downloadBytes(report.bytes, report.fileName);
      onClose();
    };
    return (
      <ConfirmDialog
        role="dialog"
        title={helped ? 'Compression ready' : 'Couldn’t make this PDF smaller'}
        message={
          helped
            ? `${COMPRESSION_PRESETS[preset].label} compression made a smaller copy. Download it?`
            : 'Nothing has been downloaded. Here’s why compression didn’t help:'
        }
        confirmLabel={helped ? `Download (${formatBytes(report.after)})` : 'Close'}
        cancelLabel={helped ? 'Close' : null}
        focusCancel={false}
        onConfirm={helped ? download : onClose}
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
        <ul className="compress__notes">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <button
          type="button"
          className="compress__retry"
          onClick={() => {
            setReport(null);
            setProgress(null);
            setState('setup');
          }}
        >
          Try a different setting
        </button>
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
          : 'Compress'
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

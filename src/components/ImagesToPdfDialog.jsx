import { useEffect, useId, useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import {
  DEFAULT_MARGIN,
  MARGINS,
  PAGE_SIZES,
  buildImagesPdf,
  defaultPageSize,
} from '../lib/imagesToPdf.js';
import { prepareImageFile } from '../lib/imageFiles.js';
import { downloadBytes } from '../lib/download.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import './ImagesToPdfDialog.css';

let keys = 0;

const baseName = (name) => name.replace(/\.[^.]+$/, '') || 'images';

/**
 * Images → PDF: order the images, pick page size and margins, then open the
 * new PDF, add it to the current document, or download it.
 */
function ImagesToPdfDialog({ files, onClose }) {
  const { hasDocument, openDocuments, addDocuments } = useDocumentContext();
  const ids = { size: useId(), margin: useId(), name: useId(), then: useId() };
  const addRef = useRef(null);
  const [items, setItems] = useState([]);
  const [pageSize, setPageSize] = useState(() => defaultPageSize(navigator.language));
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  const [then, setThen] = useState(hasDocument ? 'add' : 'open');
  const [name, setName] = useState(() => (files.length === 1 ? baseName(files[0].name) : 'images'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Read each file (PNG/JPG as-is, other formats converted) as it's added.
  const addFiles = (list) => {
    const added = Array.from(list).map((file) => ({
      key: (keys += 1),
      file,
      status: 'loading',
      url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null,
    }));
    setItems((prev) => [...prev, ...added]);
    for (const item of added) {
      prepareImageFile(item.file).then(
        (prepared) =>
          setItems((prev) =>
            prev.map((it) => (it.key === item.key ? { ...it, status: 'ready', prepared } : it))
          ),
        (err) =>
          setItems((prev) =>
            prev.map((it) =>
              it.key === item.key ? { ...it, status: 'error', error: err.message } : it
            )
          )
      );
    }
  };

  useEffect(() => {
    addFiles(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revoke thumbnail URLs when the dialog closes.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(
    () => () => itemsRef.current.forEach((it) => it.url && URL.revokeObjectURL(it.url)),
    []
  );

  const move = (index, delta) =>
    setItems((prev) => {
      const next = [...prev];
      const [it] = next.splice(index, 1);
      next.splice(index + delta, 0, it);
      return next;
    });
  const remove = (key) =>
    setItems((prev) => {
      const gone = prev.find((it) => it.key === key);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return prev.filter((it) => it.key !== key);
    });

  const ready = items.filter((it) => it.status === 'ready');
  const loading = items.some((it) => it.status === 'loading');
  const count = ready.length;

  const create = async () => {
    if (!count || loading || busy) return;
    setBusy(true);
    setError(null);
    try {
      const marginPt = MARGINS.find((m) => m.id === margin)?.points ?? 36;
      const fileName = `${name.trim() || 'images'}.pdf`;
      const bytes = await buildImagesPdf(
        ready.map((it) => it.prepared),
        { pageSize, margin: marginPt, title: name.trim() || 'Images' }
      );
      const file = new File([bytes], fileName, { type: 'application/pdf' });
      onClose();
      if (then === 'download') downloadBytes(bytes, fileName);
      else if (then === 'add') addDocuments([file]);
      else openDocuments([file]);
    } catch (err) {
      setError(`Couldn’t create the PDF: ${err.message}`);
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      role="dialog"
      className="confirm-dialog--wide"
      title="Create a PDF from images"
      message="One image per page, fitted to the page and centred. Photos keep their orientation and quality."
      confirmLabel={busy ? 'Creating…' : `Create PDF${count ? ` (${count} ${count === 1 ? 'page' : 'pages'})` : ''}`}
      confirmDisabled={!count || loading || busy}
      focusCancel={false}
      onConfirm={create}
      onCancel={onClose}
    >
      <div className="images-pdf">
        <ol className="images-pdf__list" aria-label="Images, in page order">
          {items.map((it, index) => (
            <li
              key={it.key}
              className={`images-pdf__item${it.status === 'error' ? ' images-pdf__item--error' : ''}`}
            >
              <span className="images-pdf__thumb" aria-hidden="true">
                {it.url && it.status !== 'error' && <img src={it.url} alt="" />}
              </span>
              <span className="images-pdf__info">
                <span className="images-pdf__name">{it.file.name}</span>
                <span className="images-pdf__meta">
                  {it.status === 'loading' && 'Reading…'}
                  {it.status === 'error' && `Skipped — ${it.error}`}
                  {it.status === 'ready' &&
                    `${it.prepared.orientation >= 5 ? it.prepared.height : it.prepared.width} × ${
                      it.prepared.orientation >= 5 ? it.prepared.width : it.prepared.height
                    } px`}
                </span>
              </span>
              <span className="images-pdf__actions">
                <button
                  type="button"
                  className="images-pdf__icon"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${it.file.name} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="images-pdf__icon"
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                  aria-label={`Move ${it.file.name} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="images-pdf__icon"
                  onClick={() => remove(it.key)}
                  aria-label={`Remove ${it.file.name}`}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="confirm-dialog__btn images-pdf__add"
          onClick={() => addRef.current?.click()}
        >
          Add more…
        </button>
        <input
          ref={addRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="Add images"
          onChange={(event) => {
            const list = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (list.length) addFiles(list);
          }}
        />

        <div className="images-pdf__options">
          <label className="confirm-dialog__label" htmlFor={ids.size}>
            Page size
            <select
              id={ids.size}
              className="confirm-dialog__input"
              value={pageSize}
              onChange={(event) => setPageSize(event.target.value)}
            >
              {Object.entries(PAGE_SIZES).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="confirm-dialog__label" htmlFor={ids.margin}>
            Margins
            <select
              id={ids.margin}
              className="confirm-dialog__input"
              value={margin}
              disabled={pageSize === 'fit'}
              onChange={(event) => setMargin(event.target.value)}
            >
              {MARGINS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="confirm-dialog__label" htmlFor={ids.name}>
            File name
            <input
              id={ids.name}
              className="confirm-dialog__input"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="confirm-dialog__label" htmlFor={ids.then}>
            Then
            <select
              id={ids.then}
              className="confirm-dialog__input"
              value={then}
              onChange={(event) => setThen(event.target.value)}
            >
              <option value="open">Open it for editing</option>
              {hasDocument && <option value="add">Add its pages to this document</option>}
              <option value="download">Just download it</option>
            </select>
          </label>
        </div>
        {error && (
          <p className="confirm-dialog__hint confirm-dialog__hint--error" role="alert">
            {error}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}

export default ImagesToPdfDialog;

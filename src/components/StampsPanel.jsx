import { useId, useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { useStamps } from '../hooks/StampsContext.jsx';
import { INITIALS_PRESETS, normalizeInitials } from '../lib/stamps.js';
import { STANDARD_FONTS, textLayout } from '../lib/textLayout.js';
import { measureTextWidth } from '../lib/measureText.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import './StampsPanel.css';

/** Small preview of a stamp's look: vector text via the shared layout, or the image. */
function StampPreview({ content, url }) {
  if (content.type === 'image') {
    return url ? (
      <img className="stamp-preview__img" src={url} alt="" draggable={false} />
    ) : (
      <span className="stamp-preview__placeholder" aria-hidden="true">🖼</span>
    );
  }
  const font = STANDARD_FONTS[content.font] ?? STANDARD_FONTS.Helvetica;
  const layout = textLayout(content);
  const width = measureTextWidth(content.text, content.font, content.fontSize);
  return (
    <svg
      className="stamp-preview__svg"
      viewBox={`0 0 ${width} ${layout.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {layout.lines.map((line, i) => (
        <text
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          x={0}
          y={layout.baselines[i]}
          fontFamily={font.css}
          fontStyle={font.style}
          fontWeight={font.weight}
          fontSize={content.fontSize}
          fill={content.color}
        >
          {line}
        </text>
      ))}
    </svg>
  );
}

function StampTile({ stamp, onDelete }) {
  const { activeStampId, armedStampId, selectStamp, renameStamp, previewUrls } = useStamps();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(stamp.name);

  const saveName = () => {
    setRenaming(false);
    if (draft.trim() && draft.trim() !== stamp.name) renameStamp(stamp.id, draft);
    else setDraft(stamp.name);
  };

  return (
    <li
      className={`stamp-tile${stamp.id === activeStampId ? ' stamp-tile--active' : ''}${
        stamp.id === armedStampId ? ' stamp-tile--armed' : ''
      }`}
    >
      <button
        type="button"
        className="stamp-tile__select"
        onClick={() => selectStamp(stamp.id)}
        aria-pressed={stamp.id === activeStampId}
        aria-label={stamp.name}
        title={`Place “${stamp.name}”`}
      >
        <StampPreview content={stamp.content} url={previewUrls[stamp.id]} />
      </button>
      {renaming ? (
        <input
          className="stamp-tile__rename"
          value={draft}
          aria-label={`New name for ${stamp.name}`}
          autoFocus
          maxLength={60}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={saveName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setDraft(stamp.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <span className="stamp-tile__name">{stamp.name}</span>
      )}
      {!stamp.builtIn && !renaming && (
        <span className="stamp-tile__actions">
          <button
            type="button"
            className="stamp-tile__icon"
            onClick={() => {
              setDraft(stamp.name);
              setRenaming(true);
            }}
            aria-label={`Rename ${stamp.name}`}
            title="Rename"
          >
            ✎
          </button>
          <button
            type="button"
            className="stamp-tile__icon"
            onClick={() => onDelete(stamp)}
            aria-label={`Delete ${stamp.name}`}
            title="Delete"
          >
            🗑
          </button>
        </span>
      )}
    </li>
  );
}

function InitialsForm() {
  const { addInitials } = useStamps();
  const ids = { input: useId(), hint: useId(), ink: useId() };
  const [value, setValue] = useState('');
  const [preset, setPreset] = useState(INITIALS_PRESETS[0].id);
  const [color, setColor] = useState('#000000');
  const [touched, setTouched] = useState(false);
  const result = normalizeInitials(value);

  const submit = async (event) => {
    event.preventDefault();
    setTouched(true);
    if (result.error) return;
    await addInitials(result.value, preset, color);
    setValue('');
    setTouched(false);
  };

  return (
    <form className="initials-form" onSubmit={submit} aria-label="New initials stamp">
      <label className="stamps-panel__label" htmlFor={ids.input}>
        Initials
      </label>
      <input
        id={ids.input}
        className="stamps-panel__input"
        value={value}
        placeholder="e.g. NY"
        autoComplete="off"
        maxLength={12}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={touched && Boolean(result.error)}
        aria-describedby={ids.hint}
      />
      <span
        id={ids.hint}
        className={`stamps-panel__hint${touched && result.error ? ' stamps-panel__hint--error' : ''}`}
      >
        {touched && result.error ? result.error : 'Up to 4 letters'}
      </span>

      <fieldset className="initials-form__styles">
        <legend className="stamps-panel__label">Style</legend>
        {INITIALS_PRESETS.map((p) => (
          <label key={p.id} className={`initials-style${preset === p.id ? ' initials-style--on' : ''}`}>
            <input
              type="radio"
              name="initials-style"
              aria-label={p.label}
              value={p.id}
              checked={preset === p.id}
              onChange={() => setPreset(p.id)}
            />
            <StampPreview
              content={{ type: 'text', text: result.value ?? 'AB', font: p.font, fontSize: 20, color }}
            />
            <span className="initials-style__label">{p.label}</span>
          </label>
        ))}
      </fieldset>

      <div className="initials-form__row">
        <label className="stamps-panel__label" htmlFor={ids.ink}>
          Ink
        </label>
        <input
          id={ids.ink}
          type="color"
          className="stamps-panel__color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
        />
        <button type="submit" className="stamps-panel__btn" disabled={Boolean(result.error)}>
          Save initials
        </button>
      </div>
    </form>
  );
}

/**
 * The stamps library panel: browse presets and saved stamps, create
 * initials, add signature images, rename/delete, and select one to place.
 */
function StampsPanel({ open, onClose }) {
  const { hasDocument } = useDocumentContext();
  const { stamps, status, persistent, error, dismissError, addImageStamp, deleteStamp } =
    useStamps();
  const fileRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  if (!open) return null;

  const sections = [
    { kind: 'tick', title: 'Ticks', empty: null },
    { kind: 'initials', title: 'Initials', empty: 'No initials yet — create one below.' },
    { kind: 'signature', title: 'Signatures', empty: 'No signatures yet.' },
  ];

  return (
    <aside id="stamps-panel" className="stamps-panel" aria-label="Stamps">
      <header className="stamps-panel__header">
        <h2 className="stamps-panel__title">Stamps</h2>
        <button
          type="button"
          className="stamps-panel__close"
          onClick={onClose}
          aria-label="Close stamps"
        >
          ×
        </button>
      </header>

      <div className="stamps-panel__body">
        <p className="stamps-panel__intro">
          {hasDocument
            ? 'Choose a stamp, then click the page to place it.'
            : 'Open a PDF to place stamps.'}
        </p>
        {!persistent && (
          <p className="stamps-panel__note">
            This browser isn’t letting DocuSync save stamps, so new ones last until you reload.
          </p>
        )}
        {error && (
          <p className="stamps-panel__error" role="alert">
            {error}{' '}
            <button type="button" className="stamps-panel__link" onClick={dismissError}>
              Dismiss
            </button>
          </p>
        )}
        {status === 'loading' && <p className="stamps-panel__intro">Loading your stamps…</p>}

        {sections.map(({ kind, title, empty }) => {
          const list = stamps.filter((s) => s.kind === kind);
          return (
            <section key={kind} className="stamps-panel__section" aria-label={title}>
              <h3 className="stamps-panel__heading">{title}</h3>
              {list.length > 0 ? (
                <ul className="stamps-panel__grid">
                  {list.map((stamp) => (
                    <StampTile key={stamp.id} stamp={stamp} onDelete={setPendingDelete} />
                  ))}
                </ul>
              ) : (
                empty && status === 'ready' && <p className="stamps-panel__empty">{empty}</p>
              )}
              {kind === 'initials' && <InitialsForm />}
              {kind === 'signature' && (
                <>
                  <button
                    type="button"
                    className="stamps-panel__btn stamps-panel__btn--ghost"
                    onClick={() => fileRef.current?.click()}
                  >
                    Add from image…
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                    className="stamps-panel__file"
                    aria-label="Choose signature image"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) addImageStamp(file);
                    }}
                  />
                </>
              )}
            </section>
          );
        })}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete stamp “${pendingDelete.name}”?`}
          message="It’s removed from this browser’s stamp library. Anything you’ve already stamped on a page stays."
          confirmLabel="Delete stamp"
          destructive
          onConfirm={() => {
            deleteStamp(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </aside>
  );
}

export default StampsPanel;

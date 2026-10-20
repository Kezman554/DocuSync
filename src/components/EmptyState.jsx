import { useRef } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import './EmptyState.css';

/** What the app does, under the card. Information only: none of it is a control. */
const FEATURES = [
  {
    title: 'Pages',
    text: 'Reorder, rotate, merge and split',
    icon: <path d="M8 3h9l4 4v11H8z M5 6v15h11" />,
  },
  {
    title: 'Sign and stamp',
    text: 'Draw or photograph a signature; ticks and initials',
    icon: <path d="M3 20h18 M6 16l9.5-9.5a2.1 2.1 0 0 1 3 3L9 19H6z" />,
  },
  {
    title: 'Redact',
    text: 'Blacked-out text can’t be copied back out',
    icon: (
      <>
        <path d="M4 6h16 M4 18h10" />
        <rect x="4" y="10" width="16" height="4" rx="1" fill="currentColor" />
      </>
    ),
  },
  {
    title: 'Password',
    text: 'Lock with AES-256, or unlock to edit',
    icon: <path d="M6 11h12v10H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3 M12 15v2" />,
  },
  {
    title: 'Number and watermark',
    text: 'Page numbers, or a mark across every page',
    icon: <path d="M9 4L7 20 M17 4l-2 16 M4 9h16 M3 15h16" />,
  },
  {
    title: 'Images and PDF',
    text: 'Photos into a PDF, pages out as images',
    icon: <path d="M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15.5 9.5h.01" />,
  },
];

/**
 * Shown in the well until a PDF is open. The only privacy claim is about the file.
 * Behind the card: a dot grid, light from the top left and two fanned sheets;
 * under it, a strip of what the app does. All of that is decoration or
 * information, and lets a dropped file through to the drop zone.
 */
function EmptyState() {
  const { openDocuments, requestImagesToPdf } = useDocumentContext();
  const inputRef = useRef(null);
  const imagesRef = useRef(null);

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    openDocuments(files); // several files open merged, in selection order
  };

  const card = (
    <div className="empty-state">
      {/* A document with a padlock on it. */}
      <svg className="empty-state__icon" viewBox="0 0 48 48" aria-hidden="true">
        <path
          d="M12 5h17l9 9v29H12z M29 5v9h9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <rect x="20" y="27" width="14" height="11" rx="2" fill="currentColor" />
        <path d="M23 27v-3a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2.5" />
      </svg>
      <h2 className="empty-state__title">Open a PDF to get started</h2>
      <p className="empty-state__text">
        Everything happens here in your browser. Your file is never uploaded.
      </p>
      <button
        type="button"
        className="empty-state__btn"
        onClick={() => inputRef.current?.click()}
      >
        Open PDF
      </button>
      <button
        type="button"
        className="empty-state__btn empty-state__btn--secondary"
        onClick={() => imagesRef.current?.click()}
      >
        Create PDF from images
      </button>
      <p className="empty-state__drop">or drop a PDF anywhere on this page</p>
      <input
        ref={imagesRef}
        type="file"
        accept="image/*"
        multiple
        className="empty-state__file-input"
        aria-label="Choose images"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          requestImagesToPdf(files);
        }}
      />
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="empty-state__file-input"
        onChange={handleFileChange}
      />
    </div>
  );

  return (
    <div className="empty-well">
      <div className="empty-well__dots" aria-hidden="true" />
      <div className="empty-well__light" aria-hidden="true" />
      <div className="empty-well__scroll">
        <div className="empty-well__content">
          <div className="empty-well__stack">
            <div className="empty-well__sheet empty-well__sheet--left" aria-hidden="true" />
            <div className="empty-well__sheet empty-well__sheet--right" aria-hidden="true" />
            {card}
          </div>
          <ul className="feature-strip" aria-label="What DocuSync does">
            {FEATURES.map(({ title, text, icon }) => (
              <li key={title} className="feature-strip__tile">
                <svg
                  className="feature-strip__icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {icon}
                </svg>
                <h3 className="feature-strip__title">{title}</h3>
                <p className="feature-strip__text">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default EmptyState;

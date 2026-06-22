import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import EmptyState from './EmptyState.jsx';
import './Viewer.css';

function Viewer() {
  const { hasDocument, document, currentPage } = useDocumentContext();

  if (!hasDocument) {
    return (
      <section className="viewer viewer--empty" aria-label="Document viewer">
        <EmptyState />
      </section>
    );
  }

  return (
    <section className="viewer" aria-label="Document viewer">
      <div className="viewer__page" role="img" aria-label={`Page ${currentPage}`}>
        <p className="viewer__placeholder">
          {document.name}
          <br />
          Page {currentPage}
        </p>
      </div>
    </section>
  );
}

export default Viewer;

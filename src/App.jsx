import { useState } from 'react';
import { DocumentProvider, useDocumentContext } from './hooks/DocumentContext.jsx';
import { StampsProvider } from './hooks/StampsContext.jsx';
import Toolbar from './components/Toolbar.jsx';
import ThumbnailSidebar from './components/ThumbnailSidebar.jsx';
import Viewer from './components/Viewer.jsx';
import DropZone from './components/DropZone.jsx';
import DeletePagesDialog from './components/DeletePagesDialog.jsx';
import StampsPanel from './components/StampsPanel.jsx';
import ImagesToPdfDialog from './components/ImagesToPdfDialog.jsx';
import './App.css';

/** The images → PDF dialog, shown while files are waiting in it. */
function ImagesToPdfHost() {
  const { imagesToPdf, requestImagesToPdf } = useDocumentContext();
  return imagesToPdf ? (
    <ImagesToPdfDialog files={imagesToPdf} onClose={() => requestImagesToPdf(null)} />
  ) : null;
}

function App() {
  // Sidebar visibility is only meaningful on mobile, where it acts as a
  // slide-over drawer. On desktop it is always shown via CSS.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stampsOpen, setStampsOpen] = useState(false);

  return (
    <DocumentProvider>
      <StampsProvider>
        <div className="app">
          <Toolbar
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
            stampsOpen={stampsOpen}
            onToggleStamps={() => setStampsOpen((open) => !open)}
          />
          <DropZone>
            <div className="app__body">
              <ThumbnailSidebar open={sidebarOpen} />
              {sidebarOpen && (
                <button
                  type="button"
                  className="app__scrim"
                  aria-label="Close thumbnails"
                  onClick={() => setSidebarOpen(false)}
                />
              )}
              <Viewer />
              <StampsPanel open={stampsOpen} onClose={() => setStampsOpen(false)} />
            </div>
          </DropZone>
          <DeletePagesDialog />
          <ImagesToPdfHost />
        </div>
      </StampsProvider>
    </DocumentProvider>
  );
}

export default App;

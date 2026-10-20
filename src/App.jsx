import { useState } from 'react';
import { DocumentProvider, useDocumentContext } from './hooks/DocumentContext.jsx';
import { StampsProvider } from './hooks/StampsContext.jsx';
import Toolbar from './components/Toolbar.jsx';
import NoticeStrip from './components/NoticeStrip.jsx';
import ThumbnailSidebar from './components/ThumbnailSidebar.jsx';
import Viewer from './components/Viewer.jsx';
import Inspector from './components/Inspector.jsx';
import DropZone from './components/DropZone.jsx';
import DeletePagesDialog from './components/DeletePagesDialog.jsx';
import ImagesToPdfDialog from './components/ImagesToPdfDialog.jsx';
import PasswordPromptDialog from './components/PasswordPromptDialog.jsx';
import './App.css';

/** The images → PDF dialog, shown while files are waiting in it. */
function ImagesToPdfHost() {
  const { imagesToPdf, requestImagesToPdf } = useDocumentContext();
  return imagesToPdf ? (
    <ImagesToPdfDialog files={imagesToPdf} onClose={() => requestImagesToPdf(null)} />
  ) : null;
}

/** Below this width the thumbnails are a drawer (ThumbnailSidebar.css). */
const DRAWER_QUERY = '(max-width: 767px)';

function App() {
  // The header's thumbnails toggle opens the drawer on narrow screens and
  // hides or shows the column on wider ones.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [thumbsCollapsed, setThumbsCollapsed] = useState(false);
  const [stampsOpen, setStampsOpen] = useState(false);

  const toggleThumbnails = () => {
    if (window.matchMedia?.(DRAWER_QUERY).matches) setSidebarOpen((open) => !open);
    else setThumbsCollapsed((collapsed) => !collapsed);
  };

  return (
    <DocumentProvider>
      <StampsProvider>
        <div className="app">
          <Toolbar onToggleSidebar={toggleThumbnails} />
          <NoticeStrip />
          <DropZone>
            <div className="app__body">
              <ThumbnailSidebar open={sidebarOpen} collapsed={thumbsCollapsed} />
              {sidebarOpen && (
                <button
                  type="button"
                  className="app__scrim"
                  aria-label="Close thumbnails"
                  onClick={() => setSidebarOpen(false)}
                />
              )}
              <Viewer stampsOpen={stampsOpen} onToggleStamps={() => setStampsOpen((open) => !open)} />
              <Inspector stampsOpen={stampsOpen} />
            </div>
          </DropZone>
          <DeletePagesDialog />
          <ImagesToPdfHost />
          <PasswordPromptDialog />
        </div>
      </StampsProvider>
    </DocumentProvider>
  );
}

export default App;

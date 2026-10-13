import { useState } from 'react';
import { DocumentProvider } from './hooks/DocumentContext.jsx';
import Toolbar from './components/Toolbar.jsx';
import ThumbnailSidebar from './components/ThumbnailSidebar.jsx';
import Viewer from './components/Viewer.jsx';
import DropZone from './components/DropZone.jsx';
import DeletePagesDialog from './components/DeletePagesDialog.jsx';
import './App.css';

function App() {
  // Sidebar visibility is only meaningful on mobile, where it acts as a
  // slide-over drawer. On desktop it is always shown via CSS.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <DocumentProvider>
      <div className="app">
        <Toolbar onToggleSidebar={() => setSidebarOpen((open) => !open)} />
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
          </div>
        </DropZone>
        <DeletePagesDialog />
      </div>
    </DocumentProvider>
  );
}

export default App;

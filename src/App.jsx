import './App.css';

function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">DocuSync</h1>
        <p className="app__tagline">
          Private, browser-based PDF editing — nothing leaves your machine.
        </p>
      </header>

      <main className="editor">
        <aside className="editor__sidebar" aria-label="Page thumbnails">
          <p className="editor__placeholder">Thumbnails</p>
        </aside>

        <section className="editor__canvas" aria-label="Document viewer">
          <p className="editor__placeholder">Open a PDF to get started</p>
        </section>
      </main>
    </div>
  );
}

export default App;

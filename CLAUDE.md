Project: DocuSync

A fully client-side, browser-based PDF editor for viewing, organising, annotating, and stamping PDFs — no uploads, no backend.
Built with Vite + React, pdf-lib, pdf.js, and signature_pad.

Structure


src/components/ - React UI components
src/lib/ - PDF logic, coordinate mapping, image processing
src/hooks/ - shared React hooks and state
tests/ - Vitest unit and component tests
docs/ - PRD and progress log


Commands


npm run dev - Run the app (Vite dev server)
npm test - Run tests (Vitest)
npm run build - Build static output
npm run preview - Preview the production build


Git


Do not push to GitHub without explicit permission
Commit after completing each session
Update docs/progress.txt briefly if significant work was done


Conventions


Client-side only: no network calls, uploads, or backend
Non-destructive edits held in memory; baked into the PDF on export
Page operations copy page objects, never rasterise (preserve selectable text)
Deliberate exception, do not "fix": a page with a redaction box is flattened on export (src/lib/flatten.js). pdf-lib can't remove content from a content stream, so the page is rendered with pdf.js, boxes painted black, and rebuilt from the image alone; its original objects must never be copied into the output. Applies only to pages with redaction boxes.
Pure logic (coordinate mapping, image pipeline) lives in src/lib/ with unit tests
Read DESIGN.md before any UI work
No colour, font or radius literal outside src/styles/tokens.css, except the document content DESIGN.md lists (src/lib/stamps.js colours, user-picked colours, the font picker's previews); npm run lint:styles, check:literals and check:contrast enforce it


Reference


Requirements: docs/docusync_PRD.md
Progress log: docs/progress.txt
Task prompts: Kanban app
DocuSync - Product Requirements Document

Version: 0.1
Last Updated: 2026-06-22
GitHub: https://github.com/Kezman554/DocuSync.git

Overview

Problem Statement

Common PDF tasks — reorganising pages, signing, annotating, light compression — usually mean uploading sensitive documents to web services or installing heavyweight desktop tools. None of these operations actually need to leave the browser or the user's machine.

Goals


A genuinely useful everyday PDF tool that runs entirely in the browser
Privacy-first: all processing local, with no uploads or accounts
A portfolio piece, demoable live from nickyoung.cloud


Target Users

Primarily the developer themselves, for personal document handling; secondarily anyone viewing the portfolio as a demonstration piece.

Features

Viewing & Page Management


Open and view PDFs with a thumbnail sidebar and page navigation
Rotate, drag-reorder, and delete pages
Save/export with edits baked into the output


Document Operations


Split: extract pages into a new document
Merge: combine multiple PDFs into one


Annotation & Stamps


Add text and images, placed via an on-screen overlay
Stamps library: signatures (draw, upload, or photo→transparent), plus tick and initial presets
Local persistence of saved stamps


Conversion & Stamping


PDF → images (export pages as PNG/JPG)
Images → PDF (combine images into a document)
Page numbers and watermarks


Compression


Light, browser-side compression (image re-encode, metadata strip)


Scope

In Scope


All features listed above, fully client-side
Non-destructive editing with bake-on-export
Preservation of selectable text and formatting through page operations


Out of Scope


OCR; batch/folder processing; Office → PDF conversion
Cryptographic / PKI signing
Cloud sync or user accounts
Interactive form-field filling (covered by add-text)


Future Considerations


Redaction (true content removal — requires dedicated planning)
Password protection / encryption (limited in-browser; needs research)
Cross-device stamp sync (currently per-browser by design)


Technical

Stack


Vite + React: application shell and UI
pdf-lib: PDF manipulation and export
pdf.js (pdfjs-dist): rendering and thumbnails
signature_pad: signature drawing
Canvas image processing: photo→transparent signature pipeline
IndexedDB: local stamps persistence
Vitest + React Testing Library: testing


Integrations


None (fully client-side; no external APIs or backend)


Constraints


All processing must remain client-side; no uploads
Page operations must copy page objects, never rasterise
Compression quality is bounded by browser capabilities


Project Structure

docusync/
├── docs/
│   ├── docusync_PRD.md
│   └── progress.txt
├── CLAUDE.md
├── src/
│   ├── components/
│   ├── lib/
│   └── hooks/
├── tests/
└── ...

Success Criteria


 Open a PDF and view all pages with thumbnails
 Rotate, reorder, and delete pages, then export a correct PDF
 Split and merge PDFs without losing selectable text
 Add text and images at the correct on-page position
 Create a signature (draw and photo→transparent) and place it
 Save and reuse stamps across sessions (local)
 Convert PDF↔images, add page numbers and watermarks
 Apply light compression that measurably reduces file size
 App builds to static files and runs from a static host
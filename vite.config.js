import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup.js',
    // Integration tests export real PDFs and read them back with pdf.js;
    // under a full parallel run the 5s default is too tight.
    testTimeout: 15000,
    css: true,
  },
});

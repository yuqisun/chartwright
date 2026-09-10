import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The page calls its own origin; the node process in server/proxy.mjs holds
    // the provider key and forwards. The browser never sees a credential, and
    // there is no cross-origin request to negotiate.
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  // chartwright is a linked workspace package whose entry is TypeScript source.
  // Excluding it from dependency pre-bundling lets Vite transform it directly,
  // so the example runs with no build step for the library itself.
  optimizeDeps: { exclude: ['chartwright'] },
});

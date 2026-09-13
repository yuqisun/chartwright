import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Some tools save by writing a temp file beside the target and renaming it into place — the
    // harness this example was built with does, into a `.Name.tsx.<pid>.<uuid>.tmpdir/` directory.
    // Chokidar sees the new directory, tries to watch the temp file inside it, and on Windows loses
    // the race with the rename: `EBUSY: resource busy or locked, watch ...` and the dev server exits
    // in the middle of an edit. Ignoring those paths is cheaper than restarting Vite after a save.
    // Vite appends this to its own list, so node_modules and .git stay ignored.
    watch: { ignored: ['**/.*.tmpdir', '**/.*.tmpdir/**'] },
    // The page calls its own origin; the node process in server/proxy.mjs holds
    // the provider key and forwards. The browser never sees a credential, and
    // there is no cross-origin request to negotiate.
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});

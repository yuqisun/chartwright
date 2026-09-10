import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Step 2 adds the LLM proxy here so the browser never holds a key:
    //   proxy: { '/api': 'http://localhost:8787' },
  },
});

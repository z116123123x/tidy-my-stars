import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    manifest: true,
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|react-router|react-router-dom)\//.test(id)) return 'react';
          if (/node_modules\/(fuse\.js|react-virtuoso)\//.test(id)) return 'discovery';
          if (/node_modules\/(recharts|d3-|victory-vendor|decimal\.js-light)\//.test(id)) return 'visualization';
          return 'vendor';
        }
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true
  }
});

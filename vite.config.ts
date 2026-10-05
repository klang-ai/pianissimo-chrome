import { defineConfig } from 'vite';
import { resolve } from 'node:path';
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
export default defineConfig({
  base: './',
  server: { headers },
  preview: { headers },
  build: {
    target: 'chrome120',
    sourcemap: true,
    rollupOptions: {
      input: {
        app: resolve('index.html'),
        popup: resolve('popup.html'),
        offscreen: resolve('offscreen.html'),
        permission: resolve('permission.html'),
        background: resolve('src/extension/background.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  worker: { format: 'es' },
});

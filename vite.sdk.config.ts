import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    target: 'chrome120',
    outDir: 'dist/sdk',
    sourcemap: true,
    rollupOptions: {
      input: 'src/core/client.ts',
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: 'pianissimo.js' },
    },
  },
  worker: { format: 'es' },
});

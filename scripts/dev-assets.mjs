import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public/runtime', { recursive: true });
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'])
  await copyFile(`node_modules/onnxruntime-web/dist/${name}`, `public/runtime/${name}`);

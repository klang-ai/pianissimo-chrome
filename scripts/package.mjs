import { mkdir, copyFile, writeFile, readFile, cp } from 'node:fs/promises';
await mkdir('dist/runtime', { recursive: true });
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(`node_modules/onnxruntime-web/dist/${name}`, `dist/runtime/${name}`);
}
const notices = await readFile('THIRD_PARTY_NOTICES.md', 'utf8');
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices);
console.log('Chrome extension ready: dist/');
await copyFile('LICENSE', 'dist/LICENSE');
await copyFile('PRIVACY.md', 'dist/PRIVACY.md');

await cp('licenses', 'dist/licenses', { recursive: true });

await cp('dist/runtime', 'dist/sdk/runtime', { recursive: true });

await cp('node_modules/mediabunny/src', 'dist/licenses/mediabunny/src', { recursive: true });
await copyFile('node_modules/mediabunny/package.json', 'dist/licenses/mediabunny/package.json');
await copyFile('node_modules/mediabunny/LICENSE', 'dist/licenses/mediabunny/LICENSE');
await cp('dist/licenses', 'dist/sdk/licenses', { recursive: true });
await copyFile('dist/THIRD_PARTY_NOTICES.txt', 'dist/sdk/THIRD_PARTY_NOTICES.txt');
await copyFile('LICENSE', 'dist/sdk/LICENSE');

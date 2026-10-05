# JavaScript SDK

The build creates `dist/sdk/`. Serve the whole directory, including `assets/` and `runtime/`, over HTTPS or localhost. Type declarations are in `types/`.

```js
import { Pianissimo } from '/sdk/pianissimo.js';

const recognizer = new Pianissimo();
try {
  await recognizer.load({
    modelId: 'pianissimo-sv',
    quantization: 'int8',
    threads: 4,
    onProgress: ({ phase, fraction }) => console.log(phase, fraction),
  });
  const result = await recognizer.transcribeFile(file);
  console.log(result.text, result.words);
} finally {
  recognizer.dispose();
}
```

`transcribeFile(file, { signal, onProgress })` reads a local Blob/File incrementally. It supports WAV, MP3, M4A/AAC, OGG, WebM and FLAC when the browser can decode the codec. The primary audio track is used; timestamps are relative to its start, not a delayed container timeline. Encoder padding can cause small duration differences; MP3 priming is retained by WebCodecs (about 25 ms in the fixtures). `decodeAudioChunks()` exposes the same bounded-window reader. The older `decodeAudio()` convenience helper still materializes the whole file and is intended for small inputs.

`transcribe()` accepts finite `Float32Array` samples in −1…1, at 16 kHz mono, with a minimum duration of 0.1 seconds. The caller's array is not detached. Each client runs one operation at a time. `dispose()` or an `AbortSignal` cancels work and releases the worker; load again before continuing. `clearCache()` also unloads the model and removes both models and all their variants from the cache.

Pass `modelId: 'parakeet-tdt-v3'` to `load()` for multilingual recognition (INT8). The default model ID remains `pianissimo-sv`. Parakeet does not accept a forced language and does not return a detected language label; its transcript JSON omits `language`. The `model` and `revision` fields identify the actual ONNX export.

`modelBaseUrl` can point to a mirror of the exact pinned assets; integrity checks remain mandatory. `runtimeBaseUrl` changes the location of local ONNX `.mjs`/`.wasm` files. It defaults to `runtime/` next to the SDK bundle. The low-level SDK provides file/PCM inference; live capture and orchestration are implemented separately in `src/session` and `src/core/live.ts`.

For multithreaded inference on a website, serve these headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The extension sets equivalent manifest fields. Its CSP permits local bundled JS/WASM and model downloads from Hugging Face/CDN domains. It fetches no executable code at runtime.

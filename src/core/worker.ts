import { Engine } from './engine.ts';
import { clearModelCache } from './cache.ts';
import type { Request, Response, Progress } from './types.ts';
let engine: Engine | undefined;
let busy = false;
const send = (message: Response) => globalThis.postMessage(message);
globalThis.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  if (busy) {
    send({ id: request.id, type: 'error', message: 'Another operation is in progress.' });
    return;
  }
  busy = true;
  let lastProgress = 0;
  const progress = (p: Progress) => {
    if (p.fraction === 1 || performance.now() - lastProgress > 100) {
      send({ id: request.id, type: 'progress', progress: p });
      lastProgress = performance.now();
    }
  };
  try {
    if (request.type === 'load') {
      if (engine) throw new Error('The model is already loaded.');
      engine = await Engine.load(request.options, progress);
      send({ id: request.id, type: 'done' });
    } else if (request.type === 'clear') {
      await clearModelCache();
      send({ id: request.id, type: 'done' });
    } else {
      if (!engine) throw new Error('Load a model first.');
      send({
        id: request.id,
        type: 'done',
        result: await engine.transcribe(request.audio, progress, request.type === 'window'),
      });
    }
  } catch (error) {
    send({
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : `ONNX Runtime error: ${String(error)}`,
    });
  } finally {
    busy = false;
  }
};

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { CACHE_DIRECTORY, MODEL_BASE, MODELS, type Asset } from './model.ts';
import type { Progress } from './types.ts';

async function verify(file: File, asset: Asset, progress: (p: Progress) => void): Promise<boolean> {
  if (file.size !== asset.bytes) return false;
  const hash = sha256.create();
  const reader = file.stream().getReader();
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      loaded += value.length;
      progress({ phase: 'verify', file: asset.name, fraction: loaded / asset.bytes });
    }
    return bytesToHex(hash.digest()) === asset.sha256;
  } finally {
    reader.releaseLock();
  }
}

/** A cache hit is verified too: neither a torn write nor disk corruption can reach ORT. */
export async function modelFile(
  asset: Asset,
  base = MODEL_BASE,
  progress: (p: Progress) => void,
  cacheDirectory = CACHE_DIRECTORY,
): Promise<File> {
  return navigator.locks.request('pianissimo-model-cache', async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(cacheDirectory, { create: true });
    try {
      const cached = await (await directory.getFileHandle(asset.name)).getFile();
      if (await verify(cached, asset, progress)) return cached;
      await directory.removeEntry(asset.name);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
    const estimate = await navigator.storage.estimate();
    if (estimate.quota && estimate.quota - (estimate.usage ?? 0) < asset.bytes * 1.1) {
      throw new Error('Not enough storage. Free at least 1 GB and try again.');
    }
    const response = await fetch(new URL(asset.name, base), {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok || !response.body)
      throw new Error(
        `Model download failed (HTTP ${response.status}). Check your connection and retry.`,
      );
    const handle = await directory.getFileHandle(asset.name, { create: true });
    const writer = await handle.createWritable();
    const hash = sha256.create();
    const reader = response.body.getReader();
    let loaded = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.length;
        if (loaded > asset.bytes) throw new Error('Model file size does not match.');
        hash.update(value);
        await writer.write(value);
        progress({ phase: 'download', file: asset.name, fraction: loaded / asset.bytes });
      }
      if (loaded !== asset.bytes || bytesToHex(hash.digest()) !== asset.sha256) {
        throw new Error('Model integrity check failed. Download it again.');
      }
      await writer.close();
      return handle.getFile();
    } catch (error) {
      await reader.cancel().catch(() => {});
      await writer.abort().catch(() => {});
      await directory.removeEntry(asset.name).catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  });
}

export async function clearModelCache(): Promise<void> {
  await navigator.locks.request('pianissimo-model-cache', async () => {
    const root = await navigator.storage.getDirectory();
    for (const model of MODELS) {
      try {
        await root.removeEntry(model.cacheDirectory, { recursive: true });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      }
    }
  });
}

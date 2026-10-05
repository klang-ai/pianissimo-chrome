import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
const args = process.argv.slice(2);
const modelFlag = args.find((arg) => arg.startsWith('--model='));
const model = modelFlag?.slice('--model='.length) ?? 'pianissimo-sv';
if (!['pianissimo-sv', 'parakeet-tdt-v3'].includes(model)) throw new Error('Unknown model.');
const multilingual = model === 'parakeet-tdt-v3';
const manifest = JSON.parse(
  await readFile(
    new URL(
      multilingual ? '../docs/parakeet-manifest.json' : '../docs/upstream-manifest.json',
      import.meta.url,
    ),
  ),
);
const revision = multilingual ? manifest.revision : '63730c6021234f26b9bbae9a07a04fec39e7a52e';
const repo = multilingual ? manifest.repo : manifest.model;
const requested = args.filter((arg) => arg !== modelFlag);
const variants = requested.length ? requested : multilingual ? ['int8'] : ['int8', 'int4'];
if (variants.some((q) => !(multilingual ? ['int8'] : ['int8', 'int4']).includes(q)))
  throw new Error(multilingual ? 'Parakeet supports int8.' : 'Use int8 and/or int4.');
const names = [
  ...new Set(
    variants.flatMap((q) => [
      `encoder-model.${q}.onnx`,
      `decoder_joint-model.${q}.onnx`,
      'nemo128.onnx',
      'vocab.txt',
      'config.json',
    ]),
  ),
];
const directory = multilingual ? '.models/parakeet-tdt-v3' : '.models';
await mkdir(directory, { recursive: true });
for (const name of names) {
  const spec = manifest.files[name];
  const target = `${directory}/${name}`;
  const valid = async () => {
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for await (const chunk of createReadStream(target)) {
        bytes += chunk.length;
        hash.update(chunk);
      }
    } catch {
      return false;
    }
    return bytes === spec.bytes && hash.digest('hex') === spec.sha256;
  };
  if (await valid()) {
    console.log(`Verified ${name}`);
    continue;
  }
  const response = await fetch(`https://huggingface.co/${repo}/resolve/${revision}/${name}`);
  if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status}`);
  const file = await open(`${target}.partial`, 'w');
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > spec.bytes) throw new Error(`${name}: file exceeds the pinned size`);
      await file.writeFile(chunk);
      hash.update(chunk);
    }
    if (bytes !== spec.bytes || hash.digest('hex') !== spec.sha256)
      throw new Error(`${name}: integrity check failed`);
    await file.close();
    await rename(`${target}.partial`, target);
    console.log(`Downloaded and verified ${name} (${bytes} bytes)`);
  } catch (error) {
    await file.close().catch(() => {});
    await rm(`${target}.partial`, { force: true });
    throw error;
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('model download rejects an oversized response before writing and cleans up the partial file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pianissimo-download-'));
  try {
    const manifest = JSON.parse(
      await readFile(new URL('../../docs/upstream-manifest.json', import.meta.url), 'utf8'),
    );
    const bytes = manifest.files['encoder-model.int8.onnx'].bytes;
    const script = new URL('../../scripts/download-models.mjs', import.meta.url).href;
    const stub = join(directory, 'oversized.mjs');
    // A synthetic stream length exercises the early bound without allocating
    // an actual 630 MB chunk. A write attempt would throw a different error.
    await writeFile(
      stub,
      `
      globalThis.fetch = async () => ({ ok: true, body: (async function* () {
        try { yield { length: ${bytes + 1} }; }
        finally { console.log('response closed'); }
      })() });
      await import(${JSON.stringify(script)});
    `,
    );
    const run = spawnSync(process.execPath, [stub], { cwd: directory, encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /file exceeds the pinned size/u);
    assert.match(run.stdout, /response closed/u);
    assert.deepEqual(await readdir(join(directory, '.models')), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

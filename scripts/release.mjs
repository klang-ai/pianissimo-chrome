import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
if (manifest.version !== version)
  throw new Error('Package and extension versions must match before release.');
await mkdir('release', { recursive: true });
const staging = `release/pianissimo-chrome-${version}`;
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
// Explicit runtime entries keep development files and the standalone SDK out
// of the store upload. Mediabunny source is included to satisfy its MPL license.
for (const entry of [
  'manifest.json',
  'background.js',
  'index.html',
  'popup.html',
  'offscreen.html',
  'permission.html',
  'capture-worklet.js',
  'assets',
  'runtime',
  'icons',
  'fonts',
  'brand/wave.svg',
  'licenses',
  'THIRD_PARTY_NOTICES.txt',
]) {
  await cp(`dist/${entry}`, `${staging}/${entry}`, {
    recursive: true,
    filter: (path) => !path.endsWith('.map') && !path.endsWith('.DS_Store'),
  });
}
await cp('PRIVACY.md', `${staging}/PRIVACY.md`);
await cp('LICENSE', `${staging}/LICENSE`);
const zip = `pianissimo-chrome-${version}.zip`;
await rm(`release/${zip}`, { force: true });
execFileSync('zip', ['-q', '-r', `../${zip}`, '.'], { cwd: staging });
const bytes = await readFile(`release/${zip}`);
await writeFile(
  `release/${zip}.sha256`,
  `${createHash('sha256').update(bytes).digest('hex')}  ${zip}\n`,
);
console.log(`Ready: release/${zip} (${(bytes.length / 1e6).toFixed(1)} MB)`);

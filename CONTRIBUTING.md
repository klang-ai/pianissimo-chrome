# Contributing

Bug reports, documentation fixes and focused pull requests are welcome. For a substantial feature, open an issue describing the use case before starting implementation. Keep discussions respectful and specific.

## Local development

Use Node.js 24 or later, npm and desktop Chrome.

```sh
npm ci
npx playwright install chromium chrome
npm run dev
```

Open the localhost URL printed by Vite for UI development. To exercise the extension's persistent session, run `npm run build` and load `dist/` through `chrome://extensions`. Reload the extension after rebuilding.

```sh
npm run format
npm run check
```

The check command runs formatting, unit tests, the strict TypeScript build, browser/accessibility tests, codec checks and an installed Manifest V3 test. It does not download model weights. Browser evidence goes into ignored `test-results/` and `playwright-report/` directories. Tests use isolated Chrome profiles.

## Inference changes

Run the relevant real-model suites when changing inference, decoding, caching or session lifetime:

```sh
npm run models:download
npm run test:real
npm run test:extension:real
npm run models:download -- --model=parakeet-tdt-v3
npm run test:parakeet
npm run test:parakeet:extension
```

These commands download about 1.9 GB of model assets in total; installed-extension checks also download models into their isolated browser profiles. Files under `.models/` are ignored. Never commit model weights or personal recordings. Test fixtures and their licenses are described in [tests/fixtures/README.md](tests/fixtures/README.md).

`npm run test:endurance` runs the optional two-hour file inference check. See [validation](docs/VALIDATION.md) for coverage and limitations. Native reference regeneration requires Python, `onnx-asr==0.12.0` and `onnxruntime==1.30.0`; see `scripts/reference*.py`.

## Pull requests

Explain the problem, the change and how you verified it. Add regression coverage for behavioral fixes. Include screenshots for UI changes. Preserve the local-only audio boundary and avoid new permissions unless the feature needs them. Discuss changes to model revisions or asset hashes explicitly.

Code contributions are licensed under this repository's MIT license. Preserve third-party notices and licenses. Report security issues through [SECURITY.md](SECURITY.md), not public issues.

## Releases

Update `package.json`, `package-lock.json`, `public/manifest.json` and `CHANGELOG.md` together. Run the checks and relevant model suites, then `npm run release`. The archive and SHA-256 checksum are written to `release/`. The archive excludes the SDK, source maps and development artifacts, and includes required licenses and corresponding Mediabunny source.

Publish the verified archive as a GitHub release and submit the same archive to Chrome Web Store. A submitted item is not available in the store until Google's review and publication complete. Store metadata and reviewer instructions are maintained in [docs/STORE_LISTING.md](docs/STORE_LISTING.md).

On Linux, the actual toolbar-popup tests use a displayed Chromium window. Run the checks through `xvfb-run -a npm run check` on a machine without a desktop display. CI uses the same virtual display.

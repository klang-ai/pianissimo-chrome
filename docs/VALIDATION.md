# Validation

Tests verify specific behavior; they are not a general recognition-accuracy benchmark or security certification.

## Default checks

`npm run check` runs formatting, unit tests, TypeScript compilation, production builds and Playwright checks. No model download is needed.

- Unit tests cover audio/token validation, transcript exports, pinned model definitions, bounded downloads, cancellation races, worker crashes, progress-callback failures, microphone cleanup, live word ownership and backpressure.
- Browser checks cover UI controls, keyboard navigation, dialog focus, 375 px layouts, local fonts, reduced motion and axe WCAG 2/2.1 AA rules.
- Decoder checks cover WAV, AAC/M4A, MP3, Vorbis/OGG, Opus/WebM and FLAC, codec continuity across windows, delayed container timestamps, cancellation and invalid media.
- A generated two-hour WAV checks bounded PCM windows and source reads. Renderer memory samples exclude model-worker and native decoder allocations.
- An installed Manifest V3 test opens the actual toolbar popup through Chrome's action API. It checks offscreen session persistence, popup reopening, expansion, production CSP and cross-origin isolation.

CI runs these checks on Ubuntu with Node.js 24. Browser traces, screenshots and test output are uploaded as workflow artifacts. Local artifacts are written under ignored `test-results/` and `playwright-report/` directories; running tests does not rewrite documentation.

## Real-model checks

See [CONTRIBUTING.md](../CONTRIBUTING.md) for commands and download requirements.

`test:real` checks Pianissimo INT8 and INT4 against pinned native ONNX references, silence, three natural Swedish FLEURS recordings, a 38.7-second sequence of all three recordings across file boundaries, the distributed SDK and offline cached loading. INT8 also checks longer MP3, AAC and Opus inputs. Direct PCM and incremental WAV inference use the same canonical PCM for exact output comparisons.

`test:parakeet` checks human-recorded English, German, French, Danish and Russian samples against their human references. It also checks a 52-second repeated sample, switching between both models, offline cache reuse and cache deletion. Five clips are a compatibility check, not validation of all 25 supported languages.

`test:extension:real` and `test:parakeet:extension` download real model weights under the production extension CSP. They exercise the actual popup, recording while the popup is closed, final audio flushing, file inference offline and model reload. The Swedish suite also tests controlled permission denial/retry, permission-window closure and service-worker restart. Audio comes from Chrome's WAV-backed test microphone.

`test:endurance` generates a 7,210-second WAV with five copies of a FLEURS utterance around timestamp boundaries. It checks inference through the last utterance, cancellation and cached reload. This sparse-speech input is not a continuous-conversation benchmark. The optional two-hour MP3 decoder check is documented in [fixture provenance](../tests/fixtures/README.md).

## Known limits

The local baseline was tested on macOS with desktop Chrome and Chrome for Testing. Current run results belong in the release notes and CI artifacts, so they remain tied to a specific commit.

Physical microphones, OS permission prompts, Chrome's native “Allow this time” choice, older Chrome versions and low-memory hardware need separate manual checks. Controlled-grant tests establish the permission-window lifecycle but do not prove every browser permission policy. Automated accessibility checks do not replace manual assistive-technology testing.

The Swedish model can omit speech in artificially repeated inputs. A diagnostic with the 7.8-second FLEURS sentence repeated ten times produced omissions in both native ONNX Runtime and WASM, sensitive to codec priming and window boundaries. Shorter fixed windows did not reliably remove the problem. The multi-clip long-file checks do not establish correctness for every repetition or acoustic condition.

Model timestamps are estimates at 80 ms resolution. Live inference uses overlapping windows of a noncausal model, so provisional words can change. Compressed container indexes and accumulated transcript text still grow with duration; bounded PCM does not mean constant total memory.

Chrome Web Store review and public availability are separate from passing the repository checks.

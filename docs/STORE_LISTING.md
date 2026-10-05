# Chrome Web Store listing

## Public listing

**Name:** Pianissimo

**Summary:** Transcribe audio files and microphone recordings on your device. Works offline after the first model download.

**Description:**

Turn audio into text without uploading your recording.

Pianissimo transcribes audio files and microphone recordings directly in Chrome. Choose Swedish with Klang Pianissimo, or multilingual recognition with NVIDIA Parakeet TDT v3. After the first model download, transcription works offline.

- Record from your microphone and follow the text as it appears.
- Transcribe local WAV, MP3, M4A, OGG, WebM and FLAC files when the browser supports the codec.
- Keep recording when the toolbar popup closes. Open the expanded view for longer transcripts.
- Copy the text or save TXT, SRT, VTT and JSON.
- Delete downloaded models from Settings whenever you need to free storage.

Your audio and transcripts stay on your device. No account, subscription or telemetry is required. Models download from Hugging Face, which receives normal download metadata, including your IP address.

The first model download is 515–671 MB. Use a modern desktop with enough memory for the model. Recognition speed depends on your hardware. Review transcripts before relying on them: words and timestamps can be wrong. Live text is provisional until recording is finished.

Multilingual mode supports Bulgarian, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, German, Greek, Hungarian, Italian, Latvian, Lithuanian, Maltese, Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Spanish, Swedish and Ukrainian. Norwegian is not supported. Speaker identification, translation and system-audio capture are not included.

Pianissimo is open source: https://github.com/klang-ai/pianissimo-chrome

**Category:** Productivity

**Language:** English

**Homepage:** https://github.com/klang-ai/pianissimo-chrome

**Support:** https://github.com/klang-ai/pianissimo-chrome/issues

**Privacy policy:** https://github.com/klang-ai/pianissimo-chrome/blob/main/PRIVACY.md

## Privacy declarations

**Single purpose:** Transcribe microphone recordings and user-selected local audio files into text on the user's device.

**offscreen:** The offscreen document owns audio capture and local model inference so a recording or transcription continues when the toolbar popup closes.

**unlimitedStorage:** The extension caches verified speech model files locally. Each model variant requires approximately 515–671 MB; users can download more than one variant and remove caches in Settings.

**Remote code:** No remotely hosted executable code. JavaScript and WebAssembly are bundled. Downloaded ONNX model weights and vocabulary are data, pinned to a revision and SHA-256 verified before use. The extension does not fetch JavaScript or WASM from a CDN.

**User data:** Microphone audio, selected files and transcript text are handled in local memory. The extension sends no audio or transcript to a server, and does not collect identifying, browsing, advertising or analytics data. Hugging Face receives network metadata for user-initiated model downloads. Apply the dashboard's current definitions when completing its data-use fields.

## Reviewer instructions

No credentials, payment or account is needed to use the extension.

1. Open the toolbar popup, select Swedish and choose Load model. The first download is about 661 MB and may take several minutes.
2. Select File and choose a short Swedish audio file. A redistributable example is `tests/fixtures/fleurs-5069926933251281875.wav` in the public repository.
3. Wait for Done, then copy or export the transcript. Select Live, start recording and grant microphone permission if prompted.
4. If a permission window opens, choose Allow and record and keep that window open. Close the toolbar popup, reopen it and stop recording.
5. In Settings, unload the model. Disable the network and load the cached model again to verify offline recognition.
6. To check multilingual mode, restore the network, choose Multilingual · Parakeet and load its 671 MB model. The repository includes English, German, French, Danish and Russian test clips under `tests/fixtures/multilingual/`.

The extension uses CPU/WebAssembly rather than a remote inference service. The model download is separate from the bundled executable runtime. The repository includes the full source, dependency licenses and test instructions.

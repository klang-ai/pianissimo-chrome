# Chrome Web Store listing

Version 0.3.0 was submitted for review on 5 October 2026 with automatic publication enabled. The publisher is Klang AI AB. Distribution is public, free of charge and available in all regions once approved.

**Item ID:** `dnioemmengjnkaagofjbomgdebgpghko`

**Store URL after publication:** https://chromewebstore.google.com/detail/pianissimo/dnioemmengjnkaagofjbomgdebgpghko

## Public listing

**Name:** Pianissimo

**Summary:** Transcribe audio files and microphone recordings on your device. Works offline after the first model download.

**Description:**

Pianissimo is Klang’s open speech-to-text model for Swedish, with more languages on the way. This extension lets you run it directly in Chrome.

Transcribe an audio file or record from your microphone. Your audio and transcripts stay on your computer.

Copy your transcript or export it as text or subtitles. For other languages, you can choose NVIDIA Parakeet.

Free to use and open source. No account required.

About the model

https://klang.ai/pianissimo/

About Klang.ai

Klang is a Swedish speech AI lab.

https://klang.ai/

**Category:** Productivity → Tools

**Language:** English

**Homepage:** https://klang.ai/pianissimo/

**Support:** https://github.com/klang-ai/pianissimo-chrome/issues

**Privacy policy:** https://github.com/klang-ai/pianissimo-chrome/blob/main/PRIVACY.md

## Privacy declarations

**Single purpose:** Transcribe microphone recordings and user-selected local audio files into text on the user's device.

**offscreen:** The offscreen document owns audio capture and local model inference so a recording or transcription continues when the toolbar popup closes.

**unlimitedStorage:** The extension caches verified speech model files locally. Each model variant requires approximately 515–671 MB; users can download more than one variant and remove caches in Settings.

**Remote code:** No remotely hosted executable code. JavaScript and WebAssembly are bundled. Downloaded ONNX model weights and vocabulary are data, pinned to a revision and SHA-256 verified before use. The extension does not fetch JavaScript or WASM from a CDN.

**User data:** Microphone audio, selected files and transcript text are handled in local memory. The extension sends no audio or transcript to a server, and does not collect identifying, browsing, advertising or analytics data. Hugging Face receives network metadata for user-initiated model downloads. Apply the dashboard's current definitions when completing its data-use fields.

**Dashboard categories:** Personal communications (user-selected recordings), Website content (the form's text and sound category, covering user-provided audio and transcripts), and Location (IP address received by the model download provider). No access to other websites, browsing history or device location is requested. Local processing is disclosed as required by the [Chrome Web Store User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

## Reviewer instructions

No credentials, payment or account is needed to use the extension.

1. Open the toolbar popup, select Swedish and choose Load model. The first download is about 661 MB and may take several minutes.
2. Select File and choose a short Swedish audio file. A redistributable example is `tests/fixtures/fleurs-5069926933251281875.wav` in the public repository.
3. Wait for Done, then copy or export the transcript. Select Live, start recording and grant microphone permission if prompted.
4. If a permission window opens, choose Allow and record and keep that window open. Close the toolbar popup, reopen it and stop recording.
5. In Settings, unload the model. Disable the network and load the cached model again to verify offline recognition.
6. To check multilingual mode, restore the network, choose Multilingual · Parakeet and load its 671 MB model. The repository includes English, German, French, Danish and Russian test clips under `tests/fixtures/multilingual/`.

The extension uses CPU/WebAssembly rather than a remote inference service. The model download is separate from the bundled executable runtime. The repository includes the full source, dependency licenses and test instructions.

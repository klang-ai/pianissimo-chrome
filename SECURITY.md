# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/klang-ai/pianissimo-chrome/security/advisories/new). If that form is unavailable, contact niklas@klang.ai with the subject “Pianissimo security report”.

Include the affected version, reproduction steps, expected impact and a minimal example. Do not include recordings, credentials or transcripts belonging to other people. Please allow time for investigation and a fix before public disclosure.

Security fixes target the latest released version. Earlier releases may require an upgrade.

## Security boundaries

The extension processes microphone audio and selected local files on the device. It has no content scripts, browsing-history access, remote transcription service or telemetry. Executable JavaScript and WebAssembly are bundled. Model downloads are pinned to a revision and verified against SHA-256 hashes on every load, including cached loads.

The Chrome profile, operating system, browser and installed extension code are trusted. The model cache uses Chrome's local storage; it is not an encrypted vault. Audio and transcripts remain in session memory until cleared or the session ends. Exported files and copied text are outside the extension's control.

See [the architecture](docs/ARCHITECTURE.md) and [privacy policy](PRIVACY.md) for data flow and permissions. Recognition can be wrong; review transcripts before relying on them.

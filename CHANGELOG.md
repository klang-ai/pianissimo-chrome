# Changelog

## 0.3.0

First public release of Pianissimo for Chrome.

- Local microphone and file transcription with Swedish Pianissimo and multilingual Parakeet TDT v3.
- A persistent session shared by the toolbar popup and expanded view.
- Incremental file decoding, provisional live text and TXT, SRT, VTT and JSON export.
- Pinned, verified model downloads with offline caches and no audio uploads.
- A standalone JavaScript SDK.
- Stable word ownership across overlapping windows, including delayed punctuation.
- Release hardening: immediate microphone cleanup after model-worker failure, safe progress-callback failures and cancellation of unfinished SDK operations.

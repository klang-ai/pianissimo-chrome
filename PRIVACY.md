# Pianissimo privacy policy

Effective date: 5 October 2026.

Pianissimo for Chrome is provided by Klang AI AB. It runs speech recognition on your device. This policy covers the official Chrome extension and the open source web preview.

- Audio and transcripts are not uploaded. The app has no accounts, advertising identifiers, analytics or telemetry.
- The extension keeps audio buffers and text in an offscreen session. Closing the popup or expanded view does **not** stop recording or clear the transcript. Open Pianissimo and press **Stop recording** or **Cancel** to stop capture. **Clear** removes the current transcript. Ending the browser/extension session releases its in-memory data. Explicit exports are saved by the user.
- Live audio buffers are discarded as recognition advances; the extension does not save a complete microphone recording. File audio is read and decoded in bounded windows in memory; the primary audio track is used. Neither is written to the model cache.
- Microphone access is requested after the user starts recording. Chrome may require approval in a separate permission window. The permission window’s **Allow and record** action starts a recording after authorization. It retains the permission-acquiring stream for that recording and releases it at Stop. Closing this window finishes its recording.
- Model files are downloaded from Hugging Face and its CDN. Those services receive normal network metadata, including the requester's IP address. Download requests contain no recording or transcript.
- Verified model files are stored in Chrome's Origin Private File System. **Settings → Delete downloaded models** removes both Pianissimo and Parakeet model caches. Chrome may also remove them when profile or extension data is cleared.
- `unlimitedStorage` supports the large model cache. `offscreen` lets capture and inference continue while the popup is closed. The extension has no content scripts or host permissions and does not read other websites or browsing history.
- In the ordinary web preview, closing the page ends its session. This differs from the extension's persistent offscreen session.

The extension does not sell or share your audio or transcripts, use them for advertising, or transfer them to Klang. The optional links to Klang and model documentation open external websites only when you choose them; those websites have their own privacy policies.

Chrome may contact Google to install or update the extension. Those browser and store services operate under Google's policies. They do not receive audio or transcripts from Pianissimo.

For privacy questions, contact [niklas@klang.ai](mailto:niklas@klang.ai). Changes to this policy are published in this repository with an updated effective date.

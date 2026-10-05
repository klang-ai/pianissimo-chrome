# Third-party notices

Model: KlangAI/pianissimo-sv-onnx, by Klang AI AB. Fine-tuned from NVIDIA Parakeet TDT 0.6B v3.
https://huggingface.co/KlangAI/pianissimo-sv-onnx
Model license: Creative Commons Attribution 4.0 International (CC BY 4.0).
https://creativecommons.org/licenses/by/4.0/
Revision: 63730c6021234f26b9bbae9a07a04fec39e7a52e.
The model weights are unmodified. This project implements browser inference and greedy TDT decoding.
Model weights are downloaded separately and are not part of the extension package.

ONNX Runtime Web 1.24.1, Copyright Microsoft Corporation, MIT license.
https://github.com/microsoft/onnxruntime

@noble/hashes 2.4.0, Copyright Paul Miller, MIT license.
https://github.com/paulmillr/noble-hashes

TDT decoding behavior was checked against onnx-asr by Ivan Stupakov (MIT),
https://github.com/istupakov/onnx-asr
No onnx-asr source is distributed in this extension.

The complete licenses for distributed runtime dependencies are included in licenses/.

## Geist

Bundled Geist variable font, from the Klang landing page. Copyright 2024 The Geist Project Authors. Licensed under SIL Open Font License 1.1; see `licenses/Geist-OFL.txt`.

## Pianissimo identity

Wave geometry adapted from Klang’s `SignalSculpture.tsx` in `klang-landingpage`. Brand marks remain Klang’s identity.

## Mediabunny

Mediabunny 1.61.1, Copyright 2025–2026 Vanilagy and contributors, Mozilla Public License 2.0.
https://github.com/Vanilagy/mediabunny
The library is bundled without source modifications. Its corresponding source files are supplied
in `licenses/mediabunny/src/` in the extension and SDK distributions, together with its package
metadata and license. Shared source files are included from the exact upstream revision
922054aaac0bfe5e48545a46205038d6e73dc0d1:
https://github.com/Vanilagy/mediabunny/tree/922054aaac0bfe5e48545a46205038d6e73dc0d1 The MPL applies to those library files; Pianissimo's own source remains MIT.

## Parakeet TDT v3

NVIDIA Parakeet TDT 0.6B v3, by NVIDIA, Creative Commons Attribution 4.0 International (CC BY 4.0).
https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
https://creativecommons.org/licenses/by/4.0/
ONNX conversion and INT8 quantization by Ivan Stupakov:
https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx
Export revision: 8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce.
The downloaded ONNX export is unmodified. Its weights are downloaded separately and are not included in the extension package.

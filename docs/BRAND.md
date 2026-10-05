# Pianissimo identity

The extension follows [Pianissimo’s release page](https://klang.ai/pianissimo/): Geist, cream `#f1eee6`, blue `#212bfa`, navy `#000052`, the light wordmark with a blue full stop, and pill-shaped primary buttons.

- `public/brand/wave.svg`: the 116 original contours from `klang-landingpage/src/components/pianissimo/SignalSculpture.tsx`, preserving their geometry and gradient.
- `public/brand/mark.svg`: a 23-contour symbol retaining the original surface’s horizontal proportions.
- `public/brand/mark-mono.svg`: the symbol in one color.
- `public/brand/pianissimo.svg`: portable symbol and wordmark, with text converted to paths.
- `public/icons/{16,32,48,128}.png`: transparent, antialiased Chrome icons with fewer contours at small sizes.
- `public/fonts/Geist.ttf`: bundled variable font. No font service request is needed. License: `licenses/Geist-OFL.txt`.

The opening view gives the original surface a single, gentle 1.2-second introduction, then keeps the full-size wave still. It does not loop or restart when a transcript is cleared. Reduced-motion preferences skip the introduction. It is decorative and is not presented as an audio-level measurement. The separate thin meter reports actual captured level.

Run `npm run brand` to regenerate the wave, marks and PNG icons. Run `python3 scripts/wordmark.py` (FontTools required) to regenerate the outlined lockup. These assets are checked in; rebuilding the extension does not require FontTools or the landing-page repository.

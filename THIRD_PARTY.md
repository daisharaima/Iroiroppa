# Third-party code

Everything the app ships, and its license. Iroiroppa itself is
**GPL-3.0-or-later**.

## Runtime dependencies

| Package | Version | License | Why |
| --- | --- | --- | --- |
| `jsqr` | ^1.4.0 | Apache-2.0 | QR decode for Companion pairing |
| `jscolorengine` | ^1.6.1 | MPL-2.0 | ICC profile and CMYK proofing engine (main process only); the source is at <https://github.com/glennwilton/jsColorEngine> |

## Vendored

| Name | Version | License | Location | Note |
| --- | --- | --- | --- | --- |
| `culori` | 4.0.2 | MIT | `src/renderer/vendor/culori/` | loaded as a classic script; used only through `kernel/color-interop.js`. The npm package is also a **devDependency** (same pin) as the test oracle for `test/culori-crosscheck.test.js`. |
| `helmlab` | 1.0.0 | MIT | `src/renderer/vendor/helmlab/` | loaded as a classic script; used only through `shared/color-models.js` (the HelmGen models) and `shared/colour-distance.js` (the MetricSpace distance). The npm package is a **devDependency** (same pin); `npm run vendor:helmlab` rebuilds the bundle and `test/helmlab-vendor.test.js` keeps it in step. |

## Fonts

| Name | License | Location |
| --- | --- | --- |
| Inter | SIL Open Font License 1.1 | `src/renderer/fonts/` (see `LICENSE-inter.txt`) |
| DejaVu Sans | Bitstream Vera / Arev | `src/renderer/fonts/` (see `LICENSE-dejavu-sans.txt`) |

## Development / test only

| Name | License | Note |
| --- | --- | --- |
| `electron` | MIT | the desktop shell; `LICENSE.electron.txt` and `LICENSES.chromium.html` ship with the packaged app |
| `electron-builder` | MIT | installer and portable packaging |
| `lcms-wasm` | MIT | a test-only ICC reference; not shipped |

## Color maths

| Name | License | Note |
| --- | --- | --- |
| Björn Ottosson's Okhsv / Okhsl / Okhwb reference | MIT | Ported into `src/shared/color.js` (cusp, toe, gamut intersection, the three picker spaces). The MIT notice is kept at the top of that section; nothing is copied from a copyleft implementation. |

## Acknowledgements (no code copied)

| Name | License / status | Note |
| --- | --- | --- |
| `chocolatkey/clipremote` | MIT | reference implementation of the Companion Mode wire protocol; the framing, authentication crypto and QR payload decoding here are an independent implementation informed by it. |
| `LumaPaletteCSP` by andyubird | GPL-3.0 | an earlier OKLCH picker for Clip Studio Paint; its protocol notes were consulted as documentation of observed behaviour. Iroiroppa is GPL-3.0-or-later, compatible with that work. |
| PaintPalette by echo-tree, Kroma by 秫稻_ | — | palette interface inspiration; no assets or code copied. |

Clip Studio Paint is a trademark of CELSYS, Inc. This project is unofficial and is
not affiliated with, or endorsed by, CELSYS.

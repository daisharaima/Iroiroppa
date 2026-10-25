# Third-party code

Everything the app ships, and its licence. Iroiroppa itself is
**GPL-3.0-or-later**.

## Runtime dependencies

| Package | Version | Licence | Why |
| --- | --- | --- | --- |
| `jsqr` | ^1.4.0 | Apache-2.0 | QR decode for Companion pairing |
| `jscolorengine` | ^1.6.1 | (see its LICENSE) | colour maths support |

## Vendored

| Name | Version | Licence | Location | Note |
| --- | --- | --- | --- | --- |
| `culori` | 4.0.2 | MIT | `src/renderer/vendor/culori/` | loaded as a classic script; used only through `kernel/color-interop.js` (see `docs/STATE.md`). The npm package is also a **devDependency** (same pin) as the test oracle for `test/culori-crosscheck.test.js`. |
| `helmlab` | 1.0.0 | MIT | `src/renderer/vendor/helmlab/` | loaded as a classic script; used only through `shared/color-models.js` (the HelmGen models) and `shared/colour-distance.js` (the MetricSpace distance). The npm package is a **devDependency** (same pin); `npm run vendor:helmlab` rebuilds the bundle and `test/helmlab-vendor.test.js` keeps it in step. |

## Adapted (no code copied)

| Name | Licence | Note |
| --- | --- | --- |
| `token-beam` | AGPL-3.0 OR Commercial | The state model, session layer and consumer helpers are a **clean-room** adaptation of its architecture and interfaces — no code, schema or asset is copied, so Iroiroppa stays GPL-3.0-or-later. Reusing token-beam's own code or relay would change the combined-work licence to AGPL-3.0. See `docs/STATE.md`. |

## Colour maths

| Name | Licence | Note |
| --- | --- | --- |
| Björn Ottosson's Okhsv / Okhsl / Okhwb reference | MIT | Ported into `src/shared/color.js` (cusp, toe, gamut intersection, the three picker spaces). The MIT notice is kept at the top of that section; nothing is copied from a copyleft implementation. |

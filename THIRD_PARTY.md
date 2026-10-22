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

## Adapted (no code copied)

| Name | Licence | Note |
| --- | --- | --- |
| `token-beam` | AGPL-3.0 OR Commercial | The state model, session layer and consumer helpers are a **clean-room** adaptation of its architecture and interfaces — no code, schema or asset is copied, so Iroiroppa stays GPL-3.0-or-later. Reusing token-beam's own code or relay would change the combined-work licence to AGPL-3.0. See `docs/STATE.md`. |

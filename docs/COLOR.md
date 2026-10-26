# Colour

How colour flows through Iroiroppa, and the findings that shaped it.

## Two spaces, easy to confuse

- **Displayed space** — OKLCH. The picker's axes (`L`, `C`, `H`) and its maps
  describe this. OKLab/OKLCH is a transform of CIE XYZ (D65) and is gamut
  agnostic; sRGB enters only as a *gamut* to clamp and render against. (OKLCH is
  a derived *view* of the canonical OKLab value — see *The canonical colour
  value* below.)
- **Recorded values** — the raw channel values CSP stores; this is exactly what
  the Companion protocol reports, and it carries no colour space (the same
  numbers come back from any document). Their meaning is set by the document's
  **embedded profile**, which never crosses the wire, so Iroiroppa is told it
  with the profile picker. For an Adobe RGB document those values denote Adobe
  RGB, not sRGB; the canvas merely renders them to the display.

Most of the bugs in this project's history came from treating the recorded values
as sRGB.

CSP's own *View ▸ Color profile ▸ Preview* is a different thing: it is a
**display simulation**. It renders the canvas and the colour pickers through the
working profile, but it does not change what the document stores or what the
protocol reports, so toggling it leaves the recorded hex untouched. The profile
Iroiroppa's picker wants is the document's own colour space — the one CSP shows
as the *Embedded profile* — because that is the space the records are encoded
in. (For an RGB working profile the two coincide, because CSP changes the
embedded profile to the selected working profile; a CMYK working profile only
previews and is not a matrix/TRC profile.)

## The canonical colour value — OKLab, not OKLCH

Colour selectors are not required to share a colour *model*; they share one
**appearance value** and each maps its own axes onto it. That value is **OKLab**
— rectangular, D65, unbounded. Since `a = C·cos H` and `b = C·sin H` is exactly
what the render path already computes (`oklchToRgb`), switching the canonical from
OKLCH to OKLab is a lossless reparameterisation, not a conversion.

| Layer | Space |
| --- | --- |
| Canonical value shared by every module | **OKLab (D65)** |
| Interchange at a profile/device boundary | **CIE XYZ (D65)**, adapted to D50 once for ICC |
| Polar UI view | OKLCH (derived; what the maps and readouts show) |
| Never canonical | RGB / HSL / HSV / CMYK (device- or display-encoded) |

Why OKLab rather than OKLCH:

- OKLCH is **polar**: hue is undefined at `C = 0`, so a grey has no hue and
  polar interpolation is wrong. OKLab is the rectangular parent.
- It is **perceptually uniform**, so gamut mapping, snapping and ΔE use it; it is
  also the canonical value behind every picker view.
- It is **unbounded**, so exploring past the gamut needs no special case.
- It is **already the internal transform** (`oklabToLinearRgb`), so no new maths
  is added to the picker's hot path.

Why CIE XYZ is *not* the canonical value: it is the universal, linear
interchange, but it is not perceptual, so every perceptual operation would
convert to OKLab anyway. XYZ stays where it is actually needed — the proof's
profile boundary — and OKLCH stays a derived view for the maps and readouts. If
the app ever becomes print-first (CMYK-centric), the canonical would flip to XYZ
D50; the model-adapter contract makes that a mechanical change.

**A hue anchor is kept beside the canonical value.** A rectangular space carries
no hue for an achromatic colour, so `ColorStore` remembers the last hue
separately. That reproduces exactly what the old stored `H` gave: a grey keeps its
hue and the next saturated pick does not jump to red.

**The swap is storage-only, and verified invisible.** Every colour transform
(proof, gamut, snapping, map drawing) still runs in the space and order it did;
`ColorStore.lch()` is a derived view and `setLCH()` a converting setter, so no
module changes. The rendered swatch, hex, maps and readouts are checked
unchanged — a pixel-identical screenshot, `--shot` JSON parity, and
`test/oklab-canonical.test.js`.

### The models (`src/shared/color-models.js`)

A model is a three-axis *view* over the canonical OKLab value. Registered so
far:

| id | axes | notes |
| --- | --- | --- |
| `oklch` | L, C, H | the reference view; the default |
| `oklab` | L, a, b | the canonical value itself; no hue axis |
| `cielab` | L*, a*, b* | CIELAB (D65) view; no hue axis |
| `cielch` | L*, C*, H | CIELCH, the standard cylindrical CIELAB form |
| `okhsv` | H, S, V | Ottosson's Okhsv; S/V are **sRGB-relative**, so it is only meaningful inside sRGB |
| `okhsl` | H, S, L | Ottosson's Okhsl (L is the *toe* of Oklab's L); S/L are sRGB-relative too |
| `okhwb` | H, W, B | Ottosson's Okhwb, derived here from Okhsv: `w = v(1-s)`, `b = 1-v` |
| `helmgenlch` | L, C, H | Helmlab's GenSpace in polar form: its own L/C scale (0–1, chroma 0–~0.5), hue 0–360 |
| `helmgen` | L, a, b | the same GenSpace, rectangular; no hue axis |

The OK family is `oklch`, `oklab`, `okhsv`, `okhsl`, `okhwb`: OkLab is the value
the store holds, and the three sRGB-relative pickers are Ottosson's. `cielab` and
`cielch` are CIELAB views, not a second canonical value. `helmgenlch` and `helmgen`
are the **Helmlab GenSpace** views, added on request: they round-trip through XYZ and
own no colour, so the canonical value, the proof, the records and history are
untouched. The picker's gamut still comes from the document's ICC profile — a model
never decides what is displayable.

The GenSpace transform is well conditioned inside any real display gamut (worst
1.1e-7 measured over sRGB) but degrades for colours no RGB gamut holds — OKLCH
L 0.06 at C 0.39 drifts by up to 0.13 through a round trip. That corner is
outside every working gamut and the store snaps to the working gamut, so the
picker never holds one; both models gate their contract test to sRGB (`domain`)
to keep the guarantee honest.

The Helmlab code is vendored (MIT, `src/renderer/vendor/helmlab/`, rebuilt with
`npm run vendor:helmlab`); `THIRD_PARTY.md` records it.

The picker modules (`color-slices`, `color-slider`, `color-wheel`, `color-disc`)
take a `model` setting. OKLCH keeps its analytic silhouette and gradients
byte-for-byte; another model rasterises each plane against the working gamut and
writes the store through `setLab`, so proofing, history and snapping are
untouched. `setLab` keeps the hue anchor when the value is achromatic.

A model may declare `hueIndex` (where the anchor is substituted at zero
chroma/saturation), `isAchromatic(axes)` (where that *is* for a model whose
neutral axis is not its second axis at its minimum — Okhwb), `domain` (limits the
round-trip test — the sRGB-relative three and the GenSpace pair), `lightSource`
(`native` for OKLCH/OKLab and both HelmGen views, `oklab` for OKHSV/OKHSL/OKHWB)
and `tol` (loosens the round-trip where the maths is lossy). Adding a model is one
`register()` call plus a round-trip test; `test/color-models.test.js` covers every
registered model automatically, and its lineup test pins the seven ids so an eighth
is a deliberate decision.

Every axis also carries a `role` — `lightness`, `chroma` or `hue` — and the three
slice planes are derived from it (`planesFor`): the fixed-hue plane first, then
fixed-lightness, then fixed-chroma. That is what keeps OKHSV's `V × S` slice in the
same position as OKLCH's `L × C`; a rectangular model keeps the legacy order. Slice
labels are the two free channel names in display order. `axisRange(model, i, store)`
lets OKLCH's chroma axis reach `store.cmax()`; every other axis is the declared
range.

The sRGB-referenced models (`okhsv`, `okhsl`, `okhwb`) are shaped by an **RGB cube**: S is
how far from the neutral axis toward the cube's surface, V/L is the axis position. That
cube is the *document's* when the active proof is a matrix/TRC RGB profile
(`src/shared/model-reference.js`), and the conversion is **Ottosson's own construction**
evaluated on that cube (`src/shared/ottosson.js`): the cusp is the cube's wall found by
bisection (cached per 0.05° of hue), the gamut intersection uses the cube's channel rows,
and Okhsl's control points come from the boundary. So an Adobe RGB document gets
Ottosson's perceptual Okhsv/Okhsl/Okhwb *inside its own gamut* — S, V/W, B stay in 0..1
— instead of the sRGB-limited version. A cube corner measures S ≈ 1.0003 (the triangle
approximation puts it a few 1e-4 past the wall; the axis clamps), so the round-trip is
exact at the gamut level.

A LUT/CMYK proof has **no cube** (recorded values are ink, not RGB corners), so those
documents use the **gamut-relative** mode (`ottosson.gamutRelative`): S = C ÷ the
document gamut's chroma limit at that hue and lightness (cached on a 1° × 1/96 grid), so
every S in 0..1 is a colour the document can hold. Without any profile the sRGB path is
byte-identical to the old implementation and the "sRGB reference" notice is shown
(`store.modelLimited`). The value itself is untouched in the store, and OKLCH / HelmGen
LCH are the document-gamut views. No `dense` flag may skip the working-gamut test — the
raster and the pick use the same predicate (`slice-geometry.js#inside`).

The sRGB equivalence gate lives in `test/ottosson.test.js`: on an sRGB cube the
generalised Okhsv reproduces `color.js` to 3e-3 (Ottosson's own `computeMaxSaturation` is
a fit of the wall, so the exact cusp differs slightly), the cusp equals the true boundary,
and Okhsl is monotone and round-trips. Okhsl's `Cmid` is boundary-derived rather than
Ottosson's sRGB polynomial, which is the deliberate trade for generality.

**Guide lightness is native to the model.** There is no global source setting.
`slice-geometry.js#lightnessOf` returns the model's own light axis for
`lightSource: 'native'` (OKLCH/OKLab, CIELCH, HelmGen, future CIELAB/HCT/CAM16
models) and canonical OKLab `L` for the sRGB-relative OKHSV/OKHSL/OKHWB views.
`setLightness`, `applyLightness` and `guideCurve` use the same rule: a free light
axis is solved by bisection; in a fixed-light plane the vertical free axis is
solved, which projects the press onto the iso-L contour without changing the
plane. A guide sample whose target cannot be reached within tolerance is dropped
rather than drawn along the panel edge; a drag onto that unreachable region keeps the
last reachable pointer position instead of moving past the contour. A plane/disc has no distinct line only
when its fixed axis already carries the native lightness. The module's show/hide
toggle controls whether the line is drawn; Shift uses the same native lightness.
`axisRange` lets an absolute-chroma axis reach `store.cmax()`; every other axis is
the declared range.

### Distance (MetricSpace, GenSpace's sibling)

Helmlab's other space is for *measuring*, not picking: MetricSpace, trained for
colour-difference prediction (STRESS 22.48 on COMBVD against CIEDE2000's 29.20).
`src/shared/colour-distance.js` exposes it over the app's OKLab:

| function | result |
| --- | --- |
| `difference(a, b)` | the trained metric: 0 for identical, ~0.15 and above saturating (the order still ranks) |
| `jnd(a, b)` | the same in just-noticeable-difference units — 1 JND = 0.035633; <1 unnoticed, 1–2 subtle, >2 clear |
| `nearest(lab, list)` | `{ index, distance }` for the closest colour in a list |

Bad input returns `null` and never throws, and a call costs about 0.5 µs. **No
picker uses it yet** — it exists so a module that ranks or matches colours calls
this instead of inventing a ΔE.


## The evidence

The record is the value the document holds; CSP renders it through the document's
profile. A controlled check (28 Sep 2026) wrote identical bytes with the probe
into two fresh documents and compared the filled canvas:

| Document | Bytes written | Canvas |
| --- | --- | --- |
| sRGB | `#7FFFD4` | `#7EFED4` |
| Adobe RGB (1998) | `#7FFFD4` | `#00FED3` |

The same record renders differently, so it is not an sRGB value: it is an
encoding in the document's space. (`#00FED3` is what `proofToSrgb` predicts for
Adobe RGB; an sRGB record would have shown `#7FFFD4` there too.) That is why the
**`working`** model exists: the records are already in the profile's space.

The `AdobeRGB1998.icc` profile Windows ships:

- PCS `XYZ`, illuminant D50 — but **`wtpt` is D65 and there is no `chad` tag**;
- its **colorant matrix is D50-adapted** (the columns sum to the D50 PCS white);
- its TRC is a **gamma of ≈2.2**.

## Transforms (`src/shared/proof.js`)

`createProof(profile, model)` exposes:

| Method | Meaning |
| --- | --- |
| `srgbToProof(rgb)` / `proofToSrgb(p)` | sRGB ↔ the profile's encoded space, via the D50 PCS |
| `appearanceSrgb(recorded)` | what a recorded value *looks like* (sRGB floats) |
| `recordedSrgb(appearance)` | what to record for a desired appearance |
| `readOklch(recorded)` / `writeSrgb(lch)` | the same, in OKLCH |
| `displaySrgb(lch)` | the appearanced rendered in our sRGB window |
| `inGamut(lch)` / `maxChroma(L,H)` / `reduceChroma(L,C,H)` | the profile's gamut, in OKLCH |
| `chromaIntervals(L,H)` | the in-gamut chroma bands at a lightness and hue |
| `maxChromaBound()` / `chromaAxis()` | the largest chroma in the gamut (cached) and a UI axis that contains it |

### Appearance models

**Only `working` is reachable from the UI** (the model picker was removed) and it
is the only one proven in real use. `colorimetric` and `display` are **dev-only**:
they can be selected only with `--shot --proof-model <model>` (`docs/DEV.md`) or
by hand-editing `settings.json`, and they fall back to the **sRGB** gamut rather
than the profile's. The removed control is recorded in ``.

| Model | Recorded values are… | `appearanceSrgb(v)` |
| --- | --- | --- |
| `working` | already in the profile's space | `proofToSrgb(v)` |
| `colorimetric` | sRGB, shown unchanged | `v` |
| `display` | sRGB, and the profile encoding is shown directly | `srgbToProof(v)` |

`working` and `display` are inverses of each other. `colorimetric` does no
conversion at all — it just shows the records as sRGB — which is the wrong model
whenever the document lives in the profile's space, and is exactly why `working`
exists.

### CMYK (LUT) profiles

A CMYK profile has no colorant matrix, so it takes a different route: the engine
(`jscolorengine`, a **main-process** dependency) bakes two grids and the renderer
interpolates them (`src/shared/lut.js`) — the renderer has no build step and cannot
`require` the engine.

- `createProof(profile)` dispatches to `createLutProof` whenever `profile.lut` is
  present; the matrix/TRC path is unchanged.
- The CMYK proof is **soft-proof only**: `appearanceSrgb(recorded)` routes the
  recorded sRGB through the profile and back (what it would look like printed), and
  `recordedSrgb` returns the appearance unchanged — **CSP's recorded values are
  never reinterpreted or rewritten**.
- `inGamut` is the round-trip test (a colour the profile can reproduce comes back
  close to where it started); `maxChroma` binary-searches, since a LUT has no
  chroma cubics, and `chromaIntervals` returns a single band (the
  union-of-intervals rule is a matrix artefact — see above).
- The grids are baked once per profile and cached in `proof-profiles.js` by path
  and mtime.

## Gamut and the chroma axis

The reachable set is the **profile's** gamut, not sRGB's, whenever the `working`
model is active (sRGB and Adobe RGB max out at roughly 0.32 and 0.38 chroma
respectively). Consequences:

- The maps, the chroma slider band and `clampChroma` all use the profile's
  `maxChroma`/`inGamut`.
- The chroma axis is sized from the widest chroma in the profile
  (`chromaAxis()` — scan + 5% headroom, rounded to 0.05) so a saturated green is
  not cropped off the top.
- Appearances can be **outside sRGB** (Adobe RGB is wider than sRGB). The **maps clip**
  them to the display (the channel clamp every drawing app uses), so a wide-gamut
  document keeps saturated maps; marking the region (`store.markOutOfDisplay`) paints
  the `Color.fitToSrgb` stand-in dimmed instead. The swatch and the recorded value keep
  the true chroma — only the drawn pixel is a display value.

### The boundary is not single-valued near the corners

At a fixed lightness and hue the in-gamut chroma is a **union of intervals**, not
a single range: every linear channel is a cubic in `C` (the OKLab → linear-RGB
step cubes `l_`, `m_`, `s_`, which are affine in `C`), so a ray can leave the
gamut and re-enter it. At blue's hue the set is the body `[0, 0.266]` plus a thin
fin out to the primary at `0.313` — a real, reachable colour that a plain
"largest in-gamut chroma from zero" search misses entirely and draws as
unreachable.

- `chromaIntervals(L,H)` enumerates the intervals, from the channel roots (a cubic
  solver, not a scan) — no assumption of monotonicity.
- `maxChroma(L,H)` is the **outermost** interval end, so the silhouette and the
  chroma axis contain the primaries.
- `reduceChroma(L,C,H)` is the largest interval end `<= C`, and is what snapping
  uses: an out-of-gamut chroma inside the blue band comes *down* to the body, it
  is never pulled up onto the fin.
- The maps fill every interval (`color-slices.js#buildPlot`) and give a
  sub-pixel-wide fin one scanline, so the corner is drawn without painting the
  genuinely out-of-gamut band between body and fin.

### Numerical tolerance

Both gamut tests use a **magnitude-relative** tolerance (`1e-5 × max|channel|`):

- `color.js#inGamut` tests gamma-encoded sRGB;
- `proof.js#inGamut` tests **linear** profile channels.

An absolute epsilon fails here: near black the channels are ~`1e-9`, so any
absolute epsilon counts invisible out-of-gamut chroma as displayable and leaves a
spike at the dark end of the lightness map. Conversely, too tight a tolerance
rejects real sRGB primaries, because the OKLab↔sRGB round trip carries ~1e-5
relative error near the gamut corners.

## Hex vs swatch

The footer **swatch** shows the appearance (what you see); the **hex field**
shows the *recorded* value, matching CSP's own hex readout. When they differ,
the swatch tooltip shows both.

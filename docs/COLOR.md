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
- It is **perceptually uniform**, so gamut mapping, snapping, ΔE and the
  lightness guide lines are native to it.
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
| `oklab` | L, a, b | the canonical value itself; the only model with no hue axis |
| `okhsv` | H, S, V | Ottosson's Okhsv; S/V are **sRGB-relative**, so it is only meaningful inside sRGB |
| `okhsl` | H, S, L | Ottosson's Okhsl (L is the *toe* of Oklab's L); S/L are sRGB-relative too |
| `okhwb` | H, W, B | Ottosson's Okhwb, derived here from Okhsv: `w = v(1-s)`, `b = 1-v` |

The lineup is deliberately one perceptual family. The old **CIELAB, HSV and HSL**
views were removed: OkLab/Okhsl do their job with better uniformity, and the
picker's job is a view of *one* value, not a tour of colour spaces.

The picker modules (`color-slices`, `color-slider`, `color-wheel`) take a `model`
setting. OKLCH keeps its analytic silhouette and gradients byte-for-byte; another
model rasterises each plane against the sRGB gamut and writes the store through
`setLab`, so proofing, history and snapping are untouched. `setLab` keeps the
hue anchor when the value is achromatic.

A model may declare `hueIndex` (where the anchor is substituted at zero
chroma/saturation), `isAchromatic(axes)` (where that *is* for a model whose
neutral axis is not its second axis at its minimum — Okhwb), `domain` (limits the
round-trip test — the sRGB-relative three) and `tol` (loosens it where the maths is
lossy). Adding a model is one `register()` call plus a round-trip test;
`test/color-models.test.js` covers every registered model automatically, and its
lineup test pins the five ids so a sixth is a deliberate decision.


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

The picker draws **sRGB, always** — the document profile never widens the maps
(sRGB and Adobe RGB max out at roughly 0.32 and 0.38 chroma respectively).
Consequences:

- The maps, the chroma slider band, the wheel and the disc all use sRGB's
  `maxChroma`/`inGamut`/`chromaIntervals` (`Color.*`), and the chroma axis is the
  fixed 0.4 that contains the sRGB gamut.
- Switching profiles therefore does not redraw the maps: the plot cache is keyed
  by the slice coordinates alone.
- A colour recorded by CSP can still *appear* outside sRGB (an Adobe RGB document
  can hold one). It is drawn clipped in this sRGB window, exactly like any
  wide-gamut image, and the crosshair sits above the maps when its chroma is past
  the axis. The value itself is kept (`documentCmax()`).
- Snapping is split: `gamut:'picker'` (slice/wheel picks) pulls into sRGB;
  `gamut:'record'` (CSP, hex, paste, profile re-interpretation) pulls into the
  document's own gamut, so a wide record is never clamped to sRGB.
- The **Color Slider's C track is the escape hatch**: it spans the 0.4 axis, so it
  can still be pushed into a document-only colour even though the maps stop at the
  sRGB edge; the crosshair then sits above the maps.

An inbound value from CSP is the *record*: it is converted once to its
appearance (`readOklch`) and never written back. The stat/hex keeps showing the
record, so a later write round-trips to the same value.

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

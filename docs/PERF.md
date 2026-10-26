# Performance notes

Measured with `npm run bench` (`scripts/bench.js`) on the dev machine (Windows,
Node 24). These are guides to catch regressions, not gates — re-run after
touching the colour maths, the proof transform or a render path.

## Hot paths

| Path | Cost | Notes |
| --- | --- | --- |
| `Color.inGamut` | 0.06 µs | one OKLab round trip |
| `Color.chromaIntervals` | 1.8 µs | the cubic-root boundary, once per map column |
| `Color.maxChroma` / `reduceChroma` | 2–2.8 µs | the interval search; the old `maxChroma` binary search was ~5 µs |
| `Color.oklchToRgb` / `rgbToOklch` | 0.1 / 0.16 µs | |
| a full silhouette rebuild (254 columns) | 0.5 ms | a plot-cache miss; the maps are rAF-coalesced |
| plane raster, `src/shared/raster-plane.js` (205×170) | 3.6 / 4.8 / 45 / 60 ms | CIELAB / CIELCH / HelmGen / HelmGen LCH. One conversion chain per pixel: axes → OKLab → linear sRGB → LUT gamma → sRGB bounds test; the old loop was ~6× slower (five conversions and the LUT-free `fitToSrgb` per pixel) |
| vendored `GenSpace.toXYZ` / `space.fromXYZ` | 0.99 / 0.54 µs | the reason HelmGen stays expensive: a chain of optional corrections with `hypot`/`atan2` |
| wheel ring rebuild (300²) | ~10 ms | the Color Wheel's hue ring: the gamut-max-chroma table plus the per-pixel gamut test |
| wheel inner raster (fixed-hue plane) | cached per fixed axis | it used to be keyed on every axis, so a lightness drag rebuilt it every frame (~a hundred ms for HelmGen); it is now rebuilt only when the fixed axis changes, at native device pixels during a gesture and supersampled when idle |
| `Proof.maxChromaBound` | 28 ms cold, ~0 cached | the one-off stall when a working proof is first drawn |
| `parseColorState` | 0.7 µs | one poll read; polls run at 3–10/s |

## The interactive render contract

- While a gesture is in flight (a local drag or a sibling palette's preview stream,
  `ColorStore#interactive`) modules render **one raster per frame** at most, and an
  expensive model's plane is built at native device pixels instead of 2× supersampling
  (four times fewer pixels; it stays 1:1 with the screen, never soft). The trailing
  emit after the stream ends rebuilds everything at full quality.
- A model whose last **interactive** build cost more than ~14 ms is spaced out by
  `src/shared/render-cadence.js#holdFor`; pointer, crosshair and guide keep every
  panel live. The budget must be measured in the interactive build only — the trailing
  dpr-2 plane is ~4× the pixels (OKHSV: 8.9 ms at dpr 1 vs 30–45 ms at dpr 2), and
  measuring it marked every model "expensive" and froze the maps for the whole next
  gesture.
- **The guide is a contour of the map's own lightness field** (`src/shared/contour.js`,
  marching squares over `raster-plane`'s `luma`), extracted at every cell (stride 1) with
  one-cell holes bridged: a few tenths of a millisecond per panel, and only when the map
  or the target changes. It must be extracted with the **field's own** width and height
  (the interactive map is native-pixel, the canvas is 2×); using the canvas size scrambles
  it into stacked lines. The line is also the pick (`nearestOnLines`), so a pointer near
  it selects the line's colour.
- A wheel ring drag updates the inner slice live, paced by the measured interactive build
  (never held until release), and the interactive inner build uses the real device scale.
  The disc rebuilds live from its light row under the same budget and is content-sized.
- The remaining cost is HelmGen's vendored conversion (~1.3 µs/pixel). Its plane is
  exact and spaced; taking it off the main thread (an `utilityProcess` raster host,
  like the QR compute host) is the next step if it still bites at panel size.

## What changed in the pre-1.0 pass

- **`color-history` no longer rebuilds its DOM on every live emit.** A signature
  guard (`mode:proofTag:colours`) skips the rebuild unless the list or the proof
  actually changed, and a rAF coalesces the rest. It was the biggest
  per-`pointermove` cost during a drag.
- **`color-slider` caches each track gradient.** A track is keyed by model, axis,
  the *other* two axes, gamut and direction, so the dragged row's own value does not
  invalidate it. Non-active rows are refreshed at a ~100 ms cadence while dragging;
  the active thumb, value and gradient stay immediate. That removes the old
  unthrottled ~60 conversions plus long CSS string rebuild per emit.
- Removed the unused `ColorStore.appearanceHex`.

## Deliberately left alone

- **`Proof.maxChromaBound` is a 28 ms cold scan.** It runs once per proof
  creation (a profile or model switch) and is cached on the instance. A coarser
  scan would risk cropping a narrow corner from the chroma axis, which is a
  documented invariant; a one-off 28 ms is acceptable.
- **The renderer sends a colour IPC per `pointermove`.** Main coalesces writes to
  one per 60 ms and the payload is tiny; throttling in the renderer would mean
  touching the sticky-write path for little gain.
- **`_applyLCH` snapping runs `maxChroma`/`reduceChroma` per `pointermove`**
  (2–3 µs). It is negligible next to the DOM work, and caching the boundary
  across a drag would risk a stale result.

## Module platform

- **The module command bus is a cold path.** `window.Iro.commands.call` runs only
  when a module or a bound hotkey asks for a command — never per frame, per poll or
  per pointer move. A same-window call is a direct function call; a cross-window one
  is a single IPC round trip plus the target's own work, with a 5 s timeout
  (`src/main/command-router.js`). The cost is the command, not the bus.
- **Per-instance settings writes stay debounced** (`ModuleHost._scheduleSave`, 250 ms),
  and a rebuilt board unregisters its commands on `reset()`, so nothing accumulates.
- **No new hot path was added** by the Value Checker, the shortcuts or user modules;
  `npm run bench` is unchanged from the pre-1.0 numbers above.

## Colour breadth

- **The OKLCH path is unchanged.** The canonical swap (`ColorStore` now holds
  OKLab) costs one conversion per colour change, not per pixel; `oklabToRgb` is
  the same maths `oklchToRgb` already did, and the analytic silhouette and the
  slider gradients are untouched (`test/oklab-canonical.test.js`).
- **The raster map is the one new hot path, and the drag budget is explicit.** A
  full plane is ~166 ms at 500² (`npm run bench`, ~0.4 µs/pixel: `okhsvToOklab` →
  `oklabToOklch` → `inGamut` → `oklabToRgb`). Its cache key is the plane's fixed
  axis, the gamut and the size — never the selected colour. During **any** drag the
  visible Slices rebuild **one panel per animation frame, round-robin**, at the full
  backing resolution; a panel's fixed axis is pinned only while that panel is the
  active drag, the other panels use the live axes so they visibly follow. The
  crosshair and guide are overlays redrawn on every panel every frame. Sibling panels
  reuse their full-resolution cached raster, so they never become a 1× upscale.
  ~45 ms per 1× slice plane at 354 px, at most one plane per frame.
- **The Color Wheel's outer band is a static image** (keyed on size, ring width and
  split), so it never rebuilds as the selection moves; the inner band follows the
  held lightness (quantised to 0.005 while dragging) and the cusp is cached per
  hue/axis. The rings are drawn from a fixed-lightness gamut edge (360 samples), not
  the OKHSV max-saturation path, so the blue primary has no seam. The canvas stays at
  full 2× during a drag; the raster is capped at 90 ms (150 ms when another module is
  the active drag). The guide, hue rotation and pointer redraw every frame.
  A disc build is **always full 2×**; a disc drag is a raster-cache hit because the
  fixed rim does not depend on the selected hue/chroma. While the L row is held, the
  last full-resolution disc is kept and only the pointer/guide are redrawn; one full
  build lands on release. The pointer is clamped to the current-L silhouette, not the
  fixed global rim, so an out-of-gamut C cannot leave it on white.
  The same rule covers a Wheel/Disc drag making the Slices repaint, and a Slices drag
  making the Wheel/Disc repaint. Palette and float windows disable Chromium background
  throttling so a sibling palette keeps its frame loop while another window is dragged.
- **The wheel's hue ring used to ask the gamut for its max chroma once per ring
  pixel** — ~24k `maxChroma` calls (~100 ms) at 300², and ~4× that at the 2×
  device-pixel size, a visible hitch when the module was mounted or dragged. The
  value depends only on hue (at the current lightness), so it is now sampled on a
  0.5° grid once per build and the pixel's hue is quantised to match — the ring is
  unchanged (0.5° is sub-pixel at the ring radius) and the rebuild is the per-pixel
  gamut test alone: **~10 ms at 300²** (`wheel ring rebuild (300²)`, `npm run bench`).
- **Ottosson on the document's own cube costs about a tenth more than the sRGB path.**
  A 205×170 OKHSV plane builds in ~19.5 ms with an Adobe RGB reference against ~17.6 ms
  with the sRGB one (measured in-process, average of three): the extra work is a cached
  cusp lookup (0.05° buckets) plus the cube's own matrix steps. The CMYK/LUT gamut mode
  answers its boundary from a lazily filled 1° × 1/96 grid, so a disc plane (one
  lightness row) fills 360 cells once and the H×L plane fills the grid once per
  profile; the per-pixel path after that is a bilinear lookup.

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
| a model raster plane (500²) | ~166 ms | the non-OKLCH map, ~0.4 µs/pixel; rebuilt at most ~11/s mid-drag |
| wheel ring rebuild (300²) | ~10 ms | the Color Wheel's hue ring: the gamut-max-chroma table plus the per-pixel gamut test |
| `Proof.maxChromaBound` | 28 ms cold, ~0 cached | the one-off stall when a working proof is first drawn |
| `parseColorState` | 0.7 µs | one poll read; polls run at 3–10/s |

## What changed in the pre-1.0 pass

- **`color-history` no longer rebuilds its DOM on every live emit.** A signature
  guard (`mode:proofTag:colours`) skips the rebuild unless the list or the proof
  actually changed, and a rAF coalesces the rest. It was the biggest
  per-`pointermove` cost during a drag.
- **`color-slider` rebuilds its three gradients at most once per frame** — they
  were rebuilt unthrottled (~60 colour conversions plus long strings per emit).
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
- **The raster map is the phase's one new hot path, and it is expensive.** A full
  plane is ~166 ms at 500² (`npm run bench`, ~0.4 µs/pixel: `okhsvToOklab` →
  `oklabToOklch` → `inGamut` → `oklabToRgb`). It is **rebuilt at most ~11/s while
  dragging** — `renderGenericPlots` reuses the last offscreen for a 90 ms window
  (`color-slices.js`) — at full resolution, so the baked guide lines keep their
  width; the crosshair still redraws every frame. Between drags it is cached until
  the axes or the profile change. It renders at a 1.5× supersample rather than the
  analytic path's 2.5×.
- **The Color Wheel and Color Gamut drop to 1× device pixels while dragging**
  (2× otherwise), so their disc rebuild is a quarter of the pixels mid-drag. A
  non-OKLCH model's slice release rebuild is still a ~0.1–0.3 s hitch across three
  planes — accepted: the models are opt-in and OKLCH (the default) is unaffected.
  If it becomes a complaint: rasterise at 1× and refine, or cache on a quantised
  fixed axis.
- **The wheel's hue ring used to ask the gamut for its max chroma once per ring
  pixel** — ~24k `maxChroma` calls (~100 ms) at 300², and ~4× that at the 2×
  device-pixel size, a visible hitch when the module was mounted or dragged. The
  value depends only on hue (at the current lightness), so it is now sampled on a
  0.5° grid once per build and the pixel's hue is quantised to match — the ring is
  unchanged (0.5° is sub-pixel at the ring radius) and the rebuild is the per-pixel
  gamut test alone: **~10 ms at 300²** (`wheel ring rebuild (300²)`, `npm run bench`).

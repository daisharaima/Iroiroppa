# 0006 — Plane builds are chunked; a worker was measured and rejected for the default planes

Status: accepted 2026-11-02. Code: `buildPlot` in
`src/renderer/selector_module/color-slices.js` (the hue strip shares that builder since
2026-11-04, see 0007), `kernel/plane-worker.js`.

## Context

A colour plane is a per-pixel conversion chain. Measured on this machine, building one
took 42.6 ms on the main thread, so a drag that rebuilt a panel dropped two or three
frames each time (50–63 ms long tasks, one per ~130 ms of a drag).

## Decision

Build a plane in row chunks (`PLOT_ROWS_PER_FRAME`) across animation frames, writing only
the rows each chunk produced, and keep the previous image on screen until the new plane is
complete. A Worker exists for the generic-model path, where a plane is one shared
rasteriser call; it is **not** used for the default OKLCH planes, whose per-pixel work is a
closure over the active gamut.

## Why

- Chunking removes the single blocking call without changing what is drawn: measured build
  time per frame 0.1 ms, chunk step ≤ 9.5 ms.
- The remaining frame time is Chromium rasterising the large canvases (up to 2.5× device
  pixels, ~1.1 M each) — every JS region measures ≤ 2.7 ms while frames still drop. A
  Worker cannot move rasterisation off the main thread's canvas path.
- A plane must never be cleared before its replacement exists; a blank panel is worse than
  a slightly older one.

## Rejected

- **A Worker for the default planes** — the closures (gamut test, profile) cannot cross
  `postMessage`, and it would not address the measured cost anyway.
- **Rendering at 1× during a gesture** — it would fix the raster cost, but the invariants
  forbid changing rendered resolution mid-drag because the map visibly changes. That is a
  product trade-off for the owner, not a rendering decision.

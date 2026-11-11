# 0007 — Every sibling Slices map rebuilds each frame; the plane got cheaper, not smaller

Status: accepted 2026-11-04. Code: `src/shared/slice-plane.js`,
`render-cadence.js#choosePanels`, `color-slices.js#renderPlots`.

## Context

Dragging one Color Slices panel left the other two updating in visible steps, and the
Hue × Lightness strip stopped updating at all. Two separate causes:

- the gesture rebuilt **one** panel per frame, round-robin (`Cadence#pickPanel`), so a
  sibling map landed every second or third frame;
- an analytic plane cost 7–18 ms — `Color#fitToSrgb` converts the colour, re-tests the
  gamut and converts it *again*, two full chains per painted pixel — so the H×L plane
  (17.7 ms) could not finish in the single 14 ms chunk a gesture allows. Every turn
  superseded it: `plotGeneration` bumped, the build aborted, nothing painted. Its map
  froze while the pointer kept moving. It also called `drawFins`, which only existed
  inside the other panel's builder, so the step threw before handing the map over.

## Decision

Hoist the plane's constants out of the pixel loop (the hue coefficients per column, not
per pixel), gamma-encode through the raster plane's 4096-entry LUT, and skip the second
conversion for a pixel the silhouette already proved is inside the gamut — the same
arrangement `raster-plane.js` uses. Put all three planes in that one module, and let
`choosePanels` rebuild as many stale panels as fit an 11 ms budget of the 16.7 ms frame.

## Why

- Measured: 3.2–3.8 ms per plane at 386×181 (the palette's 70k-pixel canvas budget) plus
  ~1.2 ms of per-column constants, so the two sibling maps of a drag cost ~7–10 ms
  together and land on the same frame as the pointer. The frame also paints three maps,
  three guide contours (~1.2 ms each) and three pointers.
- The picture is unchanged: `test/slice-plane.test.js` compares every plane against the
  reference `fitToSrgb` loop (no channel moves by more than one 8-bit step, the
  silhouette alpha matches, the LUT only quantises the value written).
- A model whose plane is genuinely dearer (HelmGen class, 4–45 ms) still degrades to one
  panel per frame rather than dropping frames — `choosePanels` uses the measured cost, and
  the panel at the cursor always gets its turn, so none can starve.

## Rejected

- **A half-resolution plane during a drag.** It would make the pair fit without any maths
  work, but it changes the rendered resolution between idle and drag, which the owner has
  ruled out (0006, and `canvas-size.js` keeps one 70k budget for both states).
- **Rebuilding every panel through the chunked path with a shared frame budget.** Tried
  on 2026-11-03 (3ab82e7): three competing multi-frame builds never completed during a
  drag, because each frame's new request aborted the build in flight. A plane must
  complete in the chunk it starts; that is why `plotChunks()` is 1 during a gesture.
- **Building the plane in a Worker.** Same objections as 0006: the closures carry the
  gamut and profile, and a plan that lands a frame late is what the user was reporting.

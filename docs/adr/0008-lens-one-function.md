# 0008 — A lens is one function over the document's channels, used by the map and the pick

Status: accepted 2026-11-13. Code: `src/shared/lens.js`,
`src/renderer/kernel/lens-access.js`, `docs/MODULES.md` → "Lenses".

## Context

A painter picking from a continuum often wants a deliberately coarse set — a poster study, a
limited palette, a colour-chord exercise — that they can see whole and click directly. The
picker could only show a smooth gradient, so that set had to be imagined.

"Show a quantised map but record the exact colour under the pointer" is the tempting
shortcut, and it is wrong for the same reason a display-only rotate is wrong: the map then
claims a colour the click will not produce, and the readout disagrees with the picture. Clip
Studio's own quantise dialog splits the two halves; this app does not.

## Decision

A **lens** is a transform that latches onto one selector *instance* (no board slot, no
manifest entry). It is implemented as **one pure function** used by both directions:

- `applySrgb(r, g, b)` paints a pixel;
- `applyLab(lab, …)` produces the value a pick records;

and both derive the same band from the same document value, so they cannot drift.

The grid is over the **document's own channels**, not the display's sRGB bytes. Masking the
display bytes would quietly cap an Adobe RGB document's reachable gamut at sRGB; the
document channels keep one meaning across profiles. A band's display colour depends only on
the band, so it is precomputed into a table (512 entries at 3 bits) and looked up per pixel;
past 2^18 bands the lens converts through the profile per pixel instead.

Document channels are **clamped to 0..1 before rounding**, so a band is on the grid *and*
inside the document's gamut by construction. That replaces the "quantise, then search the
neighbourhood for an in-gamut band" step the requirement first proposed: clamping cannot
fail to find a neighbour, and it cannot leave a value off the grid.

## Why

- Measured: a Slices plane costs 1.27 ms → 1.92 ms with a 3/3/3 lens on an sRGB document, and
  1.23 ms → 5.49 ms through a real Adobe RGB profile (the table path, one conversion per
  pixel). Both stay inside the 11 ms frame budget; a dearer plane keeps the existing
  one-panel-per-frame pacing.
- `test/lens.test.js` pins the invariant directly: 300 random colours through `applySrgb`
  and `applyLab` land on the same band, and every lensed value is exactly `k / (2^bits - 1)`.
- The gradient hosts (the Wheel's hue ring, the Slider's bars) get **duplicated stops**, or
  the CSS gradient interpolates back into the continuum the lens just removed.

## Rejected

- **A lens as a board module.** It is meaningless without a selector under it, and it would
  need its own settings file, mount lifecycle and board slot to hold two numbers.
- **A per-selector checkbox on every module's settings.** The lens window is where the
  effects list will grow (Gamut Mask next); a checkbox on the Slices gear would have to be
  reinvented per module.
- **Quantising the display's sRGB bytes** (cheap, and wrong on any wide-gamut document).
- **Showing the bands and picking through them only when asked** (Clip Studio's split). It
  makes the map lie.

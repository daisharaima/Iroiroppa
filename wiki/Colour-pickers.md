# Colour pickers

Four modules pick colour, and they all edit the same one colour. Use whichever suits the moment: a flat map for careful work, a wheel for speed, sliders for small nudges.

Each of them has a **Model** choice in its **⋯** menu. The list is grouped into families — **OKLab**, **CIELAB** and **HelmGen** — and **Settings ▸ Appearance ▸ Color model family** can narrow every list to one family if the full list feels long. The colour itself never changes when you switch models; only the way of describing it does.

## Color Slices

The workhorse. It shows three maps, each a flat plane with two axes:

- **Hue Slice** — lightness across one way, strength (chroma) the other, at the current hue.
- **Lightness Slice** — hue across, strength up, at the current lightness.
- **Chroma Slice** — hue across, lightness up, at the current strength.

You can reorder them, hide the ones you do not need, and rotate or flip any of them in the module's **⋯** menu; the picker follows the picture exactly. Redraw a slice by dragging in the plane — the two axes stay put while you drag, so the map cannot slide around under your cursor.

Two toggles in the ⋯ menu:

- **Lightness guide** — draws a thin contour through the colours at the current lightness.
- **Crosshair lines** — the full-width and full-height lines through the pointer.

**Shift** while dragging keeps the current lightness and moves only the other two axes — see [Pick a colour](Pick-a-colour).

> The RGB-shaped models (OKHSV, OKHSL, OKHWB) are built on sRGB, so a colour your document can hold may sit outside their map. Choose OKLCH or a HelmGen model to reach those.

## Color Wheel

A hue ring around a shaped middle. The outer band is the most colourful colour your document can hold at each hue; the inner band is the same hue at the current lightness. The middle shows the current model's slice — choose **Inner** in the ⋯ menu, plus:

- **Shape** — **Triangle** (an equilateral triangle, the classic picker) or **Square** (a wider cusp frame, better for very saturated work).
- **Ring width** — how thick the hue ring is.
- **Hue rotation** — turns the ring so red sits where you expect it.

Rotate and flip the inner shape from the same menu; the ring can be rotated too.

## Color Slider

Three tidy rows — lightness, strength, hue — for nudging a colour you already like. Options:

- **Model** — which colour model the rows describe.
- **Thickness** — how tall the rows are.
- **Orientation** — **Horizontal** or **Vertical**, useful in a narrow column.
- **Hide Values** — cleaner, if the numbers are noise to you.

**Shift** on a strength or hue row keeps the lightness.

## Color Disc

Hue and strength on a circle, with a slider-style lightness row underneath. It is the friendliest one to use while painting: a big target, one drag, no axes to think about.

- **Show out-of-gamut area** — marks the part of the disc your document cannot actually hold (see [Colour profiles and gamut](Colour-profiles-and-gamut)).
- **Shift** locks to the drawn lightness contour, so the drag follows the guide.
- Drag past the edge and it stops at the edge rather than jumping.

The disc sizes itself to its column, so it never ends up squashed.

---

Which numbers to trust? See [Colour profiles and gamut](Colour-profiles-and-gamut).

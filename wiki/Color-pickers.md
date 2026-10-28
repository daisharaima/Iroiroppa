# Color pickers

All pickers edit the same color.

![The default palette with the Color Wheel and Color Slices](images/palette.png)

Each picker has a **Model** option in its **⋯** menu. Models are grouped as **OKLab**, **CIELAB** and **HelmGen**; **Settings → Appearance → Color model family** can limit every list to one family.

## Color Slices

Three flat maps. Each map keeps its two axes fixed while you drag.

- **Hue Slice** — lightness against chroma at the current hue.
- **Lightness Slice** — hue against chroma at the current lightness.
- **Chroma Slice** — hue against lightness at the current chroma.

Use **⋯** to reorder, hide, rotate or flip maps, and to turn the **Lightness guide** or **Crosshair lines** on or off.

Hold **Shift** while dragging to keep the current lightness.

## Color Wheel

A hue ring around a shaped middle. The outer ring shows the document's most saturated color for each hue; the inner ring shows the same hue at the current lightness.

Use **⋯** for **Shape** (Triangle or Square), **Ring width**, **Hue rotation**, rotate and flip.

## Color Slider

Three rows: lightness, chroma and hue.

Use **⋯** for **Thickness**, **Orientation** and **Hide Values**. Hold **Shift** on the chroma or hue row to keep the current lightness.

## Color Disc

Hue and chroma on a circle, with a lightness row below.

- **Show out-of-gamut area** marks colors the document cannot hold.
- Drag past the edge: the pointer stops at the nearest color the document can hold.
- Hold **Shift** to follow the drawn lightness contour.

## Model limits

**OKHSV** and **OKHSL** use the document's RGB profile. In a CMYK document, choose **OKLCH** or **HelmGen LCH** to reach the full gamut.

See also [Color profiles and gamut](Color-profiles-and-gamut.md).

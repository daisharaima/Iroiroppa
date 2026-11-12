# Pick a color

1. Select a brush, pencil or fill in Clip Studio Paint.
2. Drag on a map or slider in Iroiroppa. For example, use **Color Slices**, the **Color Wheel** or the **Color Disc**.
3. Release when the color is correct.

The change is sent to Clip Studio Paint while you drag by default. Turn off **Settings → General → Live sync while dragging** to send only on release.

## Choose the target slot

| Slot | Used for |
| --- | --- |
| **Foreground** | Normal painting. |
| **Background** | Secondary color, some fills and eraser-like tools. |
| **Transparent** | The “no color” slot. |

Click a slot in **CSP Color** to choose which slot picks write to.

## Adjust a color

- Hold **Shift** while dragging to keep the current lightness.
- Use the **Color Slider** for small hue, chroma or lightness changes.
- Switch a picker's **Model** in its **⋯** menu to change how the color is described. The color itself does not change.

## Read and reuse a color

**Color Stat** shows the current color's HEX, channel values and sRGB appearance.

- Click the left half of the HEX field to copy it.
- Click the right half to paste a HEX value.
- Double-click to type a HEX value.

**Color History** shows recent colors as tiles. Click a tile to reuse that color.

## Which picker?

| Picker | Best for |
| --- | --- |
| **Color Slices** | Careful work with three flat maps. |
| **Color Wheel** | Fast hue changes. |
| **Color Slider** | Small, precise adjustments. |
| **Color Disc** | A large hue-and-chroma target. |

## Limit a picker to a few shades (a lens)

Each color picker has a small **lens** button in its title bar, just left of the arrow that
folds the card. A lens changes what the picker shows *and* what clicking it gives you, so the
picture never promises a color the click would not produce.

The only lens so far is **Quantize**. It rounds each channel to a number of bits: 3 bits per
channel leaves 512 shades, 1 bit leaves 8. The map becomes flat bands, and clicking a band
gives you exactly that band's color — useful for a poster, a limited palette or a study in
flat color. The little number row sets every channel at once; the three sliders below set
one channel at a time. 8 bits means "no change".

While a lens is on, its button is tinted and the card says `Quantize · 3/3/3`. To remove it,
open the lens window and pick **None**, or use Settings → Modules → Lenses, which lists every
picker that has one and can clear them all.

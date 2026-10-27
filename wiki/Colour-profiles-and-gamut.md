# Colour profiles and gamut

Most of the time you can skip this page. Read it when a hex code looks wrong, when colours look washed out, or when you work in a document that is not plain sRGB.

## The one idea

Clip Studio Paint stores colours as **numbers** — a bit of red, a bit of green, a bit of blue. Those numbers do not carry a colour profile with them. The **profile embedded in your document** is what gives the numbers their meaning.

So the same numbers mean different colours in different documents. `255, 0, 0` in an sRGB document is the red on the web. In an Adobe RGB document it is a noticeably deeper, more orange red. Neither is a bug; the ruler changed.

Iroiroppa can only see the numbers over the connection — the profile never crosses the wire. That is why it asks you to **tell it** which profile your document uses.

## Setting it

Two places, both doing the same thing:

- Click the **profile line in the Session panel**.
- Or **Settings ▸ General ▸ Colour profile**.

Options:

- **Default sRGB (no custom profile)** — the right choice for ordinary web and most digital work.
- The profiles it found on your PC, which you can pin for quick access.
- **Browse for ICC profile…** — for anything else, including a printer's profile.

Choose a profile once per kind of document and leave it. It does not change what Clip Studio Paint records; it changes how Iroiroppa **interprets** and **previews** those numbers.

## What proofing means here

Choosing a profile turns on **proofing**: Iroiroppa shows you how your colour will look in that profile — including a CMYK profile, which is how you check whether a print orange will survive being printed.

Proofing is a preview. Your document keeps its exact values; nothing is converted.

## "Mark colours this display can't show"

A wide-gamut document (Adobe RGB, or anything bigger) contains colours an ordinary sRGB monitor physically cannot display. Inside a colour map those are drawn clipped — as saturated as the screen allows — so the map does not fade out in a large patch.

Turn on **Settings ▸ General ▸ Mark colours this display can't show** and that region is dimmed instead, so you can see which colours will not survive on a normal screen. Off by default, because for some people the dimming is more distracting than helpful.

The single swatch above the numbers is different: it keeps the colour's lightness and pulls only its strength back, so the colour you read is as close as the screen can honestly get.

## Why the hex code might differ from Clip Studio Paint's readout

Two harmless reasons, and one worth knowing:

1. **Rounding.** Clip Studio Paint works in 8-bit channel values. A colour from a wide-gamut space often lands between two whole numbers; rounding shows a last digit or two of difference.
2. **The model.** Hex is always sRGB. If your document is Adobe RGB, the hex of a colour and the numbers Clip Studio Paint stores are two different descriptions of it.
3. **Clipping.** A colour outside what the document can hold gets clipped when it is written. Iroiroppa always snaps the values it *records* to the document's gamut, so what Clip Studio Paint ends up with is a colour the document really has.

If a colour changes the moment you send it, that is usually case 3 working correctly.

## Practical advice

- **Digital or web work:** leave it on the default sRGB and forget this page.
- **Print work:** set the document's CMYK or printer profile, turn proofing on, and pick with the dimmed out-of-gamut region showing.
- **Wide-gamut painting:** set Adobe RGB (or your document's profile) once. Then the pickers' maps, and especially the wheel's hue ring, show the colours your document actually has.

---

The colours still look wrong? See [Troubleshooting](Troubleshooting).

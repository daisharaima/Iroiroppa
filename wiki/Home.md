# Iroiroppa — a colour picker for Clip Studio Paint

Iroiroppa is a small window that floats on top of Clip Studio Paint. You pick a colour on a map or a slider, and the brush, line or fill you are painting with changes as you drag. It works like the official phone app: it connects to Clip Studio Paint the same way your phone does.

![The Iroiroppa palette, connected and showing a colour](images/palette.png)

## Where to start

| I want to… | Go to |
| --- | --- |
| Install it | [Install](Install) |
| Get it talking to Clip Studio Paint | [Connect to Clip Studio Paint](Connect-to-Clip-Studio-Paint) |
| Pick my first colour | [Pick a colour](Pick-a-colour) |
| Find the window again (it vanished) | [The tray icon and the hotkey](Tray-and-hotkey) |
| Fix something that is not working | [Troubleshooting](Troubleshooting) |

## What you need

- Windows 10 or Windows 11, 64-bit.
- Clip Studio Paint with **Companion Mode** — the "Connect to smartphone" feature. Tested on Clip Studio Paint 5.0.4.
- No plugins, nothing installed inside Clip Studio Paint, no files to patch. Iroiroppa is one program on its own.

## What it is not

- **Not made by CELSYS.** Iroiroppa is an unofficial hobby project. Clip Studio Paint and Companion Mode belong to CELSYS, and Companion Mode is an undocumented feature that a Clip Studio Paint update could change or break.
- **Not a phone app.** It plays the part of the phone in Companion Mode. That is the trick that lets it talk to Clip Studio Paint without a plugin.
- **Not signed by a software publisher.** Windows will warn you the first time you run it; this is normal for a free hobby program. See [Install](Install).
- **Not a colour converter for your document.** It reads and writes the colours Clip Studio Paint already uses; it does not change your files.

## New to OKLCH?

Iroiroppa describes colours in **OKLCH** — a way of naming a colour by how light it is, how strong it is, and which hue it is. That is a different way of describing the same colours you already know as hex codes. Every word is explained in the [Glossary](Glossary), and [Colour profiles and gamut](Colour-profiles-and-gamut) covers the one part that surprises people: why a hex code can look wrong in a wide-gamut document.

---

Lost? [Troubleshooting](Troubleshooting) is the fastest page to skim.

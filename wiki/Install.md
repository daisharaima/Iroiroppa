# Install

## Which file to download

Open the [Releases page](https://github.com/daisharaima/Iroiroppa/releases) and find the newest release. It has two downloads:

| File | Use it if |
| --- | --- |
| `Iroiroppa.Setup.<version>.exe` | You want a normal install with a Start menu entry. This is the usual choice. |
| `Iroiroppa-Portable-<version>.exe` | You want one self-contained file you can move around or keep on a USB stick. |

Both are the same program. Nothing else on the page needs downloading.

## Run it

1. Double-click the file you downloaded.
2. Windows may show a blue **"Windows protected your PC"** box. That happens because the program is free and unsigned — no company is vouched for. Click **More info**, then **Run anyway**.
3. If you chose the installer, follow it through. It will close a copy of Iroiroppa that is already running before it replaces files.
4. Iroiroppa opens as a small palette. If Clip Studio Paint is open with its QR code showing, it connects by itself — see [Connect to Clip Studio Paint](Connect-to-Clip-Studio-Paint).

> **Careful:** only download Iroiroppa from the releases page linked above. Any other site offering it is not the project.

## Setup versus Portable — where your settings go

- **Installed:** settings, your saved connection, your layout and your colour history live in `%APPDATA%\Iroiroppa`.
- **Portable:** the same things live in a folder called `Iroiroppa Data` right next to the `.exe`. The whole thing is self-contained — copy the exe and that folder together and your settings travel with it.

The two keep separate folders, so you can have an installed copy and a portable copy on the same PC without them fighting.

## First launch

You get the default palette: a **Session** row at the top, then **CSP Color**, **Color Stat**, **Color Slices** and **Color Slider**. Nothing is locked; you can move, resize, hide and duplicate everything. Start with [Connect to Clip Studio Paint](Connect-to-Clip-Studio-Paint).

Reopen it later from the Start menu, or from the tray icon near the clock — see [The tray icon and the hotkey](Tray-and-hotkey).

## Updating

Download the new version and run it over the old one. Your settings, saved connection, layout, history and workspaces are kept — they live outside the program.

## Getting rid of it

See [Reset, uninstall and back up](Reset-uninstall-and-backup) for removing it completely, settings included.

## What it needs

- Windows 10 or Windows 11, 64-bit.
- Clip Studio Paint 5.0.4 or a nearby version, with Companion Mode available.
- An internet connection is only needed to download it and to check for updates. It works offline.

---

If Windows refuses to run it, or the window never appears, see [Troubleshooting](Troubleshooting).

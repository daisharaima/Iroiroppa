# Iroiroppa — an OKLCH colour picker for Clip Studio Paint

A small Windows popup that picks colours in **OKLCH** and pushes them straight
into Clip Studio Paint. It connects like the official phone app — by
impersonating the phone side of CSP's **Companion Mode** ("Connect to
smartphone"). No plugins, no scripts inside CSP, no file patching.

![Iroiroppa, connected to a Companion Mode host](docs/screenshot.png)

## Features

- **Colour picking** — gamut maps, sliders and colour history in **OKLCH**
  (the default), **OKHSV**, **HSV**, **HSL**, or **CIELAB**; switching model keeps
  the same colour because each is a view of one canonical value. Sliders mark
  out-of-gamut regions with a hard edge, slices rotate or flip, every channel value
  is editable, and a module's settings can be copied onto another.
- **Two-way sync** — changes in CSP appear here (~10 Hz while they happen, ~3 Hz
  idle); dragging the picker updates Clip Studio Paint live.
- **Profiles and proofing** — choose the document profile from the Session picker
  or Settings, with a distinct **Browse for ICC profile…** action. Proofing keeps
  the recorded value and its appearance distinct; RGB and LUT-based **CMYK**
  profiles both prove, and a CMYK proof never rewrites what CSP recorded.
- **Know what you are holding** — a colour card with the swatch, the HEX (copy,
  paste or type one), the L/C/H and sRGB values, and how far the current colour is
  from the last one you stored. With a proof profile active it says which numbers
  are the *stored* ones and which are what you see on screen.

## Install

Grab the installer or the portable build from
[Releases](https://github.com/daisharaima/Iroiroppa/releases). The builds are
unsigned, so Windows SmartScreen may warn on first run ("More info" → "Run
anyway"). Requires Windows 10/11 (64-bit) and Clip Studio Paint with Companion
Mode (tested on CSP 5.0.4).

## Use

1. In CSP: **File ▸ Connect to smartphone**, leave the QR visible.
2. Iroiroppa connects on its own — it pairs and reads the current colour, and
   reconnects on later launches. If it has not connected, click the **Session** row.
3. Drag a map or slider: CSP follows while you drag (turn *Live sync* off to send
   only on release). Click the header squares to switch CSP between foreground,
   background and transparent.

Settings live in their own window: connection and behaviour under **General**
(which also shows the app's version), theme / UI scale / accent under
**Appearance**, and per-module options (including switching modules on and off)
under **Modules**. Click the **⋯** on a module's header for its own options.

## From source

Needs Node 18+:

```bash
npm install
npm start        # npm run dev for devtools
npm test         # protocol, colour and proof layers (no Electron needed)
npm run dist     # installer + portable build
```

`scripts/probe.js` is a standalone CLI client for testing the protocol without
the GUI; only one controller may connect at a time, so quit the app first.

See `AGENTS.md` and `docs/` for the protocol notes, colour pipeline and developer
flags.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the build/test loop, the docs map and
the branch/release flow. `AGENTS.md` is the short guide for AI agents.

## Credits

Genuine thanks to everyone below — this app stands on their work:

- Protocol reverse engineering: [chocolatkey/clipremote](https://github.com/chocolatkey/clipremote) (MIT).
- Companion Mode field notes and a great deal of inspiration: [andyubird/LumaPaletteCSP](https://github.com/andyubird/LumaPaletteCSP) by **andyubird** (GPL-3.0) — an OKLCH picker for CSP that does this first.
- OKLab / OKLCH colour space: [Björn Ottosson](https://bottosson.github.io/posts/oklab/).
- Palette UI inspiration: **PaintPalette** by echo-tree and **Kroma** by 秫稻_ (both on Bilibili).
- QR decoding: [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0).
- Building on [Electron](https://www.electronjs.org/) and [electron-builder](https://www.electron.build/).

## AI disclosure

Iroiroppa is **vibecoded**: the code and the prose are written by AI — **DeepSeek**
models driven through an AI coding agent — while the direction comes from a human
who is not a programmer. In practice that means the feature ideas, the decisions
and the checking come from a person, and the implementation comes from the models;
there is a test suite and there are design notes, but no professional developer has
written or reviewed this code.

Please judge it as what it is: a hobby project that works, made to be shared. Bug
reports and fixes are very welcome. And since it was made this way, it feels
right for it to stay free to use, study and share.

## Licence

GNU General Public License v3.0 or later — see [LICENSE](LICENSE).

Iroiroppa is free software: you may use, study, change and share it, as long as
derivative works stay free too.

Iroiroppa is unofficial and not affiliated with CELSYS, Inc. Clip Studio Paint
and Companion Mode are theirs; Companion Mode is undocumented and may change in
any CSP update. Windows and the fonts used belong to their respective owners.

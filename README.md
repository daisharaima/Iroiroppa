# Iroiroppa — an OKLCH colour picker for Clip Studio Paint

A small Windows popup that picks colours in **OKLCH** and pushes them straight
into Clip Studio Paint. It connects like the official phone app — by
impersonating the phone side of CSP's **Companion Mode** ("Connect to
smartphone"). No plugins, no scripts inside CSP, no file patching.

![Iroiroppa, connected to a Companion Mode host](docs/screenshot.png)

## Features

- **Pick colours visually** — choose colours on maps and sliders in OKLCH and other models, then send them straight to Clip Studio Paint.
- **Two-way sync** — colours changed in Clip Studio Paint appear here, and changes here update Clip Studio Paint live.
- **Colour-profile preview** — see how a colour will look in the document's colour profile, including CMYK, without changing what Clip Studio Paint records.
- **A clear colour readout** — see the current colour's hex code and channel values at a glance.
- **A modular palette** — build the panel from small modules: show, hide, duplicate, resize and arrange them, or pop one out into its own window.

## Modules

Each module does one job and can be shown, hidden, duplicated, resized with its settings or by dragging its bottom edge.

- **Session** — connection status, the document's colour profile and the Settings button. Appearance → **Color model family** limits every model list to OKLab, CIELAB or HelmGen; all models remain views over the same canonical OKLab value.
- **CSP Color** — Clip Studio Paint's foreground, background and transparent colour slots.
- **Color Slices** — three named maps (`L × C`, `H × C`, `H × L`), reorderable in the module settings; all of them follow a drag live, and Shift keeps the model's native lightness.
- **Color Wheel** — a fixed outer hue band and a contextual inner one, with the model's slice or an inscribed equilateral / cusp triangle in the middle; the inner shape can be rotated/flipped and the hue ring rotated.
- **Color Slider** — fine-tune lightness, chroma and hue with sliders; Shift on a chroma/hue row keeps the model's native lightness.
- **Color Disc** — hue × chroma on a circle with a full Slider-style lightness row underneath; Shift locks the model's native lightness contour.
- **Color History** — recently picked colours you can reuse.
- **Color Stat** — the current colour's hex code and channel values.
- **CSP Shortcuts** — search and run Clip Studio Paint's own commands (you can point it at a non-default CSP data folder).

## Install

Grab the installer or the portable build from
[Releases](https://github.com/daisharaima/Iroiroppa/releases). The installer
closes a running copy of Iroiroppa before it replaces files. The portable build
keeps its settings, saved pairing, layout and history in `Iroiroppa Data` beside
the exe, so the folder is self-contained — copy both to carry it to another PC.
The builds are unsigned, so Windows SmartScreen may warn on first run ("More
info" → "Run anyway"). Requires Windows 10/11 (64-bit) and Clip Studio Paint
with Companion Mode (tested on CSP 5.0.4).

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
- GenSpace / MetricSpace colour spaces: [Helmlab](https://helmlab.space/) by **Görkem Yıldız** (MIT), vendored in `src/renderer/vendor/helmlab/`.
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

# Modular architecture

The architecture for a modular, themeable, user-arrangeable picker.

Status: **all phases implemented** (0–6) — the kernel split; the
`csp-color`, `color-slices` and `color-slider` modules; the Hue slice; theme files
+ dropdown with an editable accent; per-module settings with the gear popover;
the resizable board (`layout.json`); drag-to-reorder with edge-drop to create a
column; floats with a Dock action and snap-to-dock; and responsive orientations
with drag-out-to-float. The **`color-history`** module (recently picked colours,
main-owned so every window shares one list) was added after the plan.

The picker modules take a **colour-model** setting (`src/shared/color-models.js`,
docs/COLOR.md): OKLCH by default, with OKLab, CIELAB, CIELCH, OKHSV, OKHSL
and the two Helmlab GenSpace views (HelmGen, HelmGen LCH) as alternate views over
the same canonical OKLab value. Appearance → **Color model family** filters every list
to one family.

---

## 1. Vision

- The picker is assembled from **selector modules**, each in its own file.
- Modules can be **rearranged** on a kanban-like board, **resized**, and
  **floated** into their own windows.
- A module's **appearance adapts to its box** (e.g. sliders go vertical when the
  box is taller than it is wide).
- **Themes** are data files; users add their own.
- Each module keeps its **own settings file**, separate from the layout, so a
  module update or removal never destroys user settings.

## 2. Decisions (locked)

| Area | Decision |
| --- | --- |
| Module code location | **Bundled in the app** (`selector_module/`). User-loadable *code* is out of scope for now (it would require relaxing the renderer CSP). |
| Themes | **Data-only JSON token files**; users may drop their own into the app-data `themes/` folder. Accent is a token, so themes recolour it. |
| Module settings scope | One file **per module id** (shared across instances), versioned. |
| Floating a module | The **"Float this module" action** moves it to its own window; drag-out-to-desktop + snap-to-edge followed later. |
| Module settings UI | An **in-module popover** opened from a gear icon in the module header. |
| Settings persistence | **Debounced**, separate files; never block the UI. |

## 3. Architecture

**Kernel + modules + chrome.**

- **Kernel** (`src/renderer/kernel/`): the single source of truth and the
  plumbing.
  - `color-store.js` — holds `L/C/H`, `transparent`, and the three slots; routes
    through the proof transform; emits change events. ✅
  - `module-host.js` — discovers/loads modules, mounts them, feeds them size and
    settings, and routes colour changes. ✅
  - `layout.js` — the board model (columns/modules/floats) + persistence.
    ✅
  - `themes.js` — loads and applies theme tokens. ✅
  - `module-settings.js` — per-module settings I/O (over IPC). ✅ —
    folded into `module-host.js` (debounced writes) + a main-process
    `modules:get`/`modules:set` pair.
  - `boot.js` — wires it all together. (This lives in `app.js`.)
- **Modules** (`src/renderer/selector_module/<id>.js`): self-contained UI;
  **read** colour from the store and **request** changes; never own colour state.
- **Chrome** (not modules): the title bar. The connection banner, the profile-switcher mode bar
  and the footer (swatch/hex/tools) *were* chrome and are the `session` and `color-stat` modules
  now, so they appear in every palette (docs/LAYOUT.md, "One palette").

### Colour flow

```
module ──request──▶ ColorStore ──▶ proof routing ──▶ csp.writeColor (coalesced)
   ▲                                                      │
   └──────────── subscribe ─────────────◀── poll/Sync ────┘
```

The sticky-write, partial-merge, adaptive-poll and proof behaviour all stay in
the kernel exactly as they are today.

## 4. Module contract

A module is a **classic script** that registers itself. ES modules (static or
dynamic `import()`) are blocked by CORS over `file://`, and bundling a custom
protocol isn't worth it here — so `module-host.js` injects a
`<script src="selector_module/<id>.js">` for each manifest entry and mounts it
once it has loaded.

```js
// src/renderer/selector_module/color-slider.js
(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};

  reg.modules['color-slider'] = {
    id: 'color-slider',
    name: 'Color Slider',
    version: 1,
    defaults: { /* module settings */ },
    settingsUI(api, root) {}, // the settings UI (popover and Settings window); may use
                              // kernel/model-options.js — a throw is shown, never blank
    minSize(settings) {},     // the smallest box that shows everything
    create(ctx) {
      // ctx.el       : container element the module fills
      // ctx.id       : the module id
      // ctx.color    : the ColorStore (read state, request changes)
      // ctx.csp      : the window.csp bridge
      // ctx.settings : { get(), patch(partial) }  (persisted per module id)
      // ctx.log      : namespaced logger
      return {
        onResize(rect) {},   // the module box changed size
        onSettings(next) {}, // settings changed
        settings(root) {},   // build the settings popover UI into `root`
        destroy() {},
      };
    },
  };
})();
```

`ctx.color` is the kernel `ColorStore`. The surface modules use:

**Where `settingsUI` renders.** The same function builds the ⋯ popup
(`module-settings.html`) and the Settings window's Modules tab, so both pages load
`kernel/model-options.js` and both wrap the call in `try/catch` (a throw is shown, never a
blank section). The Model control is an in-page menu from that helper, not a native
`<select>`: a select's list is an OS window outside the topmost band and would open
behind the page.

| Call | Purpose |
| --- | --- |
| `lch()` | current `{ L, C, H }` |
| `subscribe(fn)` | redraw on any change; returns an unsubscribe |
| `setLCH(lch, { notify })` | request a change; `notify` is `live` (drag), `commit` (release) or `none` |
| `selectSlot('main' / 'sub' / 'transparent')` | ask CSP to activate a slot |
| `proofOn()` / `useWorkingGamut()` / `proof` / `proofInfo` / `mode` | the active proof |
| `inGamut(L,C,H)` / `maxChroma(L,H)` / `cmax()` | the active gamut |
| `readRecorded(rgb)` / `contentRgb(lch?)` / `appearanceRgb(lch?)` / `contentHex(lch?)` | recorded ↔ appearance |
| `plotKeyTag()` | cache key for the active gamut + profile |
| `dragging` / `lastStored` | shared flags the module reads/sets |

Modules **read** colour from the store and **request** changes; they never own
colour state. A map that *is* a shape (the Disc is a disc; a dense model's plane is
total) never leaves transparent holes: an out-of-document-gamut pixel is drawn as the
sRGB stand-in at reduced opacity, so the shape stays whole and the region still reads as
out of gamut. The lightness guide is traced from the map it is painted on (that map's
fixed light), never from the live colour across a paced map. The runtime registry is `window.Iro.modules` (each module registers
itself); the *list* of modules is `src/shared/module-manifest.js` — the single
source of truth for ids and metadata (`name`, `autoHeight`, `instanceable`, `group`, `capabilities`), read
by main (the Settings → Modules list, and the layout model's registry) and by the
renderer (what to mount, and the first-run board). **Adding a module = the file
under `selector_module/` + an entry in the manifest + the two docs**; `npm test`
fails until the manifest, the files on disk and the docs all agree. A **user
module** (docs/USER-MODULES.md) is the same contract loaded from
`%APPDATA%\Iroiroppa\user-modules\<id>\` over `module://` instead of
`selector_module/`, with its metadata read from an optional `module.json`.

### Capabilities

A module may depend on the channels the app reaches CSP over — the Companion
protocol (`companion`), a live window capture (`capture`), native senders
(`sender`), and the always-available `stub`.
It declares them on its def (or `module.json`) as
`{ <channel>: 'required' | 'optional' }`:

- a missing **required** channel makes the module render an "unavailable — why"
  card instead of mounting (it does not silently do nothing);
- a missing **optional** channel only degrades it, and the module may switch
  source on `ctx.capabilities.on(…)`.

Main owns the live set (`src/main/capabilities.js`) and every window mirrors it
(`src/renderer/kernel/capabilities.js`); the pure model is
`src/shared/capabilities.js`. `--cap-off <id>` / `--capabilities <id>` force a
channel for a `--shot`.

### State adapters

A module reads shared state from the **canonical model**, never from a raw channel
(docs/STATE.md). The kernel hands a module the domains it needs through an
**adapter** — a pure function from a canonical snapshot to view effects, registered
with `window.Iro.state.register(domain, fn)`. A module that produces a palette
publishes it as a `palette:` token domain; it consumes other domains through the
same contract. In `--legacy-state` mode the per-domain channels are the source, so
a module must not assume the model is present; the canonical model is the default.

### Module commands

A module may expose commands for another module to call. Return a `commands` map
from `create(ctx)` (the handlers close over the mounted instance), or — for a
stateless one — put `commands` on the def (each is then called with
`(ctx, ...args)`):

```js
create(ctx) {
  return {
    commands: {
      async setView(view) { /* ... */ return view; },
    },
  };
}
```

Call one by **instance id** through the kernel bus `window.Iro.commands`:
`Iro.commands.call(targetInstanceId, 'setView', ['rgb'])` returns a Promise, and
`Iro.commands.list()` returns `{ instanceId: [name, …] }` across every window.

Addressing is per **instance** — a module id may be mounted many times, so the
instance is the only unambiguous target. Commands are async and
JSON-serializable: arguments and results cross IPC, so no functions or DOM nodes.
`src/main/command-router.js` owns the routing (main is the only place that knows
which window mounts which instance) and correlates a cross-window call by
`callId` with a timeout; `src/renderer/kernel/command-bus.js` runs a call locally
when this window mounts the target. A renderer that does not load the bus (the
Settings preview) simply exposes no commands.

## 5. Files & folders

```
src/renderer/
  index.html, style.css        chrome + the board container
  app.js                       kernel boot + chrome
  kernel/
    color-store.js             colour state + proof/gamut routing
    module-host.js             loads/mounts modules
    themes.js                  loads/applies theme tokens
    layout.js, module-settings.js              (later phases)
  selector_module/
    color-slices.js
    color-slider.js
    color-wheel.js
    color-disc.js
    csp-color.js
    csp-shortcuts.js
    color-history.js
    color-stat.js
    session.js
  themes/
    default-light.json         theme token sets
    default-dark.json
```

App data (`%APPDATA%\Iroiroppa\`; a portable build uses `Iroiroppa Data`
beside its exe):

```
settings.json        global app settings
session.json         Companion pairing
layout.json          board structure + floats
modules/<id>.json    per-module settings (one per module id)
themes/              optional user themes
user-modules/        optional user modules (docs/USER-MODULES.md) — one folder per id
```

Two of those modules are worth knowing about before you touch them:

- **`session.js`** — the app's own control panel and the only singleton. It is **one row**: the dot
  (the connection state *and* the action; its tooltip carries “Connected to Clip Studio Paint” or the
  current state), the **profile dropdown** (shows the document's current color profile), the lock and
  the gear. No connect/scan buttons: the app connects by itself, Disconnect is in the module's ⋯ panel
  and the tray, and the dropdown is drawn by the overlay (it can leave the palette) and asks for a
  fresh profile scan so it lists every ICC profile main knows.
- **`color-stat.js`** — the colour in hand. Swatch, HEX (copy/paste/type), L/C/H in the same display
  units as the OKLCH sliders, sRGB, and a `ΔE` row against the previous stored colour. The swatch and
  the sRGB row are the colour *on screen*; the HEX and L/C/H are what the document *stores* — with a
  proof profile active they differ, and a `≠` marker says so.

### `layout.json`

```json
{
  "version": 1,
  "columns": [
    { "id": "c1", "width": 260,
      "modules": [
        { "instanceId": "i1", "moduleId": "csp-color",   "weight": 12 },
        { "instanceId": "i2", "moduleId": "color-slices", "weight": 420 },
        { "instanceId": "i3", "moduleId": "color-slider","weight": 92 }
      ] }
  ],
  "floats": [
    { "floatId": "f1", "x": 900, "y": 120, "width": 260, "height": 420,
      "snap": "left",
      "columns": [ { "id": "f1c1", "width": null, "modules": [ … ] } ] }
  ]
}
```

A module's `weight` is its proportional share of the column (the column always
fills the window, so resizing trades weight between neighbours); `null` uses the
module's default. A column's `width` is optional in the same way.

> **This is schema v1, the current file.** The rewrite replaces it with v2 — a
> flat list of palettes, an `auto`/`px`/`fill` height per module, and per-palette
> placement — and migrates a v1 file on load, losslessly. Read
> **`docs/LAYOUT.md`** for the v2 shape; `src/main/layout-store.js#migrateV1` is
> the converter.

### `modules/<id>.json`

```json
{ "version": 1, "settings": { "constantChroma": true } }
```

On load, a module receives its stored `settings` merged over its `defaults`.
Unknown keys are preserved; a version bump lets a module migrate its own keys.

### `themes/<id>.json`

```json
{ "id": "default-light", "name": "Default Light", "dark": false,
  "tokens": { "--bg": "#ffffff", "--text": "#1b1f2a", "--accent": "#6c5ce7" } }
```

Tokens mirror the CSS custom properties already in `style.css`. Applying a theme
sets them on `:root`; `dark` controls `color-scheme` and any dark-only details.
The loader lists bundled themes plus user themes in `%APPDATA%\Iroiroppa\themes`.

## 6. The board

✅ Columns, resize, drag and persistence. Floats followed.

> The board's design is being replaced by a single unified model with no
> main-window/sub-window split; **`docs/LAYOUT.md`** is the spec from here on.
> Everything below describes the v1 board still in the tree.

- A horizontal **row of columns**, each **full height** so the board stays a
  rectangle. Columns are resizable by dragging the divider between them
  (`width` in `layout.json`; `null` means fill).
- Modules stack inside a column and are resized by dragging the **gap between
  two modules** (`weight` in `layout.json`), which trades height between them. A
  column always fills the window and never scrolls. Drag a module by its **grip**
  to reorder it within a column or drop it into another column (a drop line shows
  where it lands); dragging to the board's **left or right edge** creates a column
  there. A module moved to another column re-flows to fill it if it is alone.
  Empty columns are pruned. A module's settings popover carries a **Column**
  picker when more than one column exists.
- Each module header shows the **name** and the **grip** (drag to move,
  right-click for settings).
- Empty columns and empty dock targets are shown as drop zones.

### Interaction phases

| Phase | Interaction |
| --- | --- |
| 3 | ✅ Resize columns and modules; persist `layout.json`. |
| 4 | ✅ Drag to reorder within/between columns, with drop indicators; edge-drop creates a column. |
| 5 | ✅ "Float this module" → a float window snapped to the palette, with a Dock action. |
| 6 | ✅ Drag a module out of the palette to float it; drag a float over the palette to dock it. |

Floats are separate frameless `BrowserWindow`s (`float.html`) that run **the same
`Board` as the palette** — a float is a small board with its own columns, so it
lives in `layout.json` as `{ floatId, x, y, width, height, snap, columns }`.
**Cross-window dragging does not exist** (HTML5 DnD does not span BrowserWindows),
so a drag released outside its own window is resolved in the main process: the
window under the pointer (the palette or another float) receives
`module:accept` and places the module by the drop point (left/right edge → a new
column; over a module → insert there; on the body → append), and the source
removes it. Released over nothing, the module gets a float of its own. Dragging a
float over the palette still docks its modules (a hint while armed, then dock).

Cross-window drags show the **destination indicator** too: while a module is
dragged over another window (a float, or the palette from a float), that window
draws the same line/edge as a same-window drag, so the landing spot is visible
before the release. Dragging a **whole float** onto the palette is
position-aware: over a column body its modules merge into that column, and on a
seam between columns its own columns are inserted there (the palette grows to
fit). A float can also be **collapsed** to a compact bar (the grip, or a lone
module's header) with the eye button, without closing it. If a float ends up
off-screen (an unplugged monitor), the tray's **Bring floats back on screen**
pulls it back.

## 7. Responsive modules

✅ Revised Oct 2026. Modules adapt to **their own box**, not the window.
The kernel calls `onResize(rect)` for layout; the module sets a `data-orientation`
attribute and its stylesheet reacts.

The orientation is a **setting** now (`horizontal` | `vertical`), per instance, for
the three pickers — not a guess from the box shape. The old "taller than wide →
vertical" auto-flip is gone, so resizing a box never turns the module under the
pointer.

| Module | Horizontal | Vertical |
| --- | --- | --- |
| `color-slider` | three horizontal sliders | three vertical sliders |
| `csp-color` | three boxes in a row | three boxes stacked |
| `color-slices` | the three maps side by side | the three maps stacked |

Sizing is **locked-ratio** (`docs/LAYOUT.md`, "Height modes"): CSP Color, Color
Slices, Slider and Color History derive their height from the column width
times a per-instance ratio, set with the **Module Size** slider in Settings →
Modules (or a module's own ⋯ popup). The number beside the slider is editable;
the label alone is not the control. Dragging a card's **bottom edge** writes the
same ratio (see "Module edge drag" below). Color Stat and Session keep their
content height (`auto`) and have no edge handle.

### Module edge drag

A locked-ratio module's bottom edge is its height: the drag writes the same
`height: { mode: 'ratio', ratio }` as the Module Size slider (capped at 2.5 and
floored at `_minHeightOf`). A shared edge resizes the ratio module above it (or the
one below when the above is a fill); the splitter's weight-trading remains for
columns with no ratio module. The last module gets its own `.module-edge` handle
whose hit area is *inside* the card, so it outranks the OS window-resize border;
the palette's outer edge (and the 12 px corner grip) still resizes the window.
Auto-height modules (Color Stat, Session) have no edge. `ratioFromDrag()` in
`layout-model.js` is the shared maths and is unit-tested.

### Picker extras

- **Color Slider** — each of the three channels has its own "mark out of gamut" toggle.
  The track is sampled and the in/out boundary is written as two stops at the same
  percentage, so the edge is crisp (no gradient). Horizontal sliders use left/right
  nudge arrows; vertical sliders keep up/down. Hue nudges by one whole degree; the
  other axes land on the displayed precision. The thumb is a small **ring**, matching
  the Slices pointer. There is no lightness guide line in this module; holding Shift
  on a chroma/hue row still holds the model's native lightness and solves the light axis.
- **Color Slices** — the three slices are named by their two free channels in display
  order (`L × C`, `H × C`, `H × L`; OKHSV's first is `V × S`). The first is always
  the fixed-hue slice, so the lineup is consistent across models. Each row has a
  show/hide box, a reorder gripper (drag, or ArrowUp/ArrowDown) that persists
  `sliceOrder`, plus rotate (90° steps) and flip-H/flip-V buttons. The transform is
  display-only: `slice-view.js` draws the finished plot through it, and picking
  applies the exact inverse before the shared axis mapping (`slice-geometry.js`), so
  the colour under the pointer is the colour picked.

  Slices are always drawn flat (no projection choice). The raster and the pick test
  the **same** reachability predicate, so a shown pixel is always pickable; the
  sRGB-referenced models (OKHSV/OKHSL) cannot represent a colour outside sRGB,
  so their crosshair is clamped to the panel edge (a dashed outer ring) instead of
  disappearing. Colours the screen cannot show are drawn as the sRGB-edge colour at
  the same lightness (`Color.fitToSrgb`).

  While any drag is active, every other visible slice is rebuilt in turn (one panel
  per animation frame at native 1× CSS resolution, overlays every frame), so the other
  maps visibly follow the selected L/C/H without downscaled or blocky edges. On
  release every panel is rebuilt at full device resolution.

  The **crosshair** is the old full-width/height pair of hairlines through the
  pointer; the **pointer** is a separate small ring. Both are thin. The **lightness
  guide** is one overlay polyline through the selected colour, styled as a
  ~1 px light/dark hairline. It is drawn when the module's **Lightness guide** toggle
  is on; Shift holds the model's native lightness for the gesture (pressed before or
  during the drag; releasing resumes). A plane whose fixed axis *is* that native
  lightness is wholly one value, so it has no line. In a fixed-light plane the pointer is
  projected onto the contour by solving the chroma axis, so the plane stays put. The
  line turns red while locked.
- **Color Wheel** — a two-band hue ring around the model's hue slice. The **outer**
  band is a fixed-lightness (OKLab L = 0.70) gamut-edge reference that never changes
  with the selection; using the max-saturation OKHSV path instead follows the sRGB blue
  fin and jumps at the primary, which is the old blue seam. The **inner** band is the
  same continuous hue edge at the selected OKLab L. Both turn the hue (Shift on either
  band holds the chosen lightness). A **Hue rotation** slider rotates both bands and
  the ring picking; it does not rotate the inner L/C shape. The inner shape has its own
  **rotate / flip-H / flip-V** controls (the same display-only view transform as
  Slices; the raster transform and `SV.forward()` agree, so picking stays under the
  pointer). The inner slice is the model's own geometry: OKLCH shows its flat L×C slice
  (the lens is seen whole, and its chroma axis is the working gamut), while
  OKHSV/OKHSL have a **square ⇄ triangle** switch. OKHSV's fixed triangle is
  **equilateral and inscribed** in the ring's hole. OKHSL's cusp frame keeps the
  **square mode's black-white side** and puts the cusp on x = 0.9. Both map the whole
  square onto the triangle. The inner shape carries the single thin guide (module
  toggle); the hue pointer sits on the **outer** band and is the same small ring as the
  Color Slider, while the inner pointer is a small ring too. The canvas uses one
  native device-pixel backing in idle and drag; `store.interactive` changes only the
  paced rebuild, so the map does not visibly change quality when a drag begins.
- **Color Disc** — the hue × chroma plane on a circle, with the third axis (L or V) on
  a Slider-style row below: the same `.rng` gradient, ring thumb, value field,
  steppers and full-colour track as the Color Slider module. The radius is the model's
  own saturation axis: OKHSV/OKHSL use relative s, so the disc is a true circle;
  OKLCH/OKLab/CIELAB/CIELCH/HelmGen use absolute chroma, so the rim is **fixed at the global
  in-gamut extent across reference lightnesses**, not recomputed at the selected L.
  The in-gamut silhouette at the current L grows/shrinks inside that fixed rim;
  re-scaling the rim per L made the pointer slide radially whenever the L row moved. Out of gamut is transparent, like the slices, and a press snaps to the
  boundary (shown == pickable); a rectangular model reads its hue from `atan2(b, a)`.
  The pointer itself is clamped to the **current-L silhouette**, not the global rim, so a
  stored chroma outside that silhouette cannot leave it on the transparent white area; the
  fixed rim still keeps in-gamut pointers from sliding radially as L changes.
  The single thin guide follows the model's native lightness; the module has its
  own show/hide toggle. Shift projects a disc drag onto the contour. A native-light
  model can make the whole disc one value, in which case there is no contour and Shift
  is a no-op. The disc canvas uses one native device-pixel backing in idle and drag;
  while the L row moves the disc rebuilds live, paced by the measured interactive build.
  A drag that leaves the disc keeps following the pointer at the rim (the ring is drawn
  from the event, not from the stored colour), so a locked lightness that cannot be
  reached never freezes it.

  The module is **content-sized** (`autoHeight`): the canvas takes the palette width and
  its height follows (`aspect-ratio: 1`), so the card ends under the footer. A column
  share only ever left an empty band beneath a circle. Its model list keeps one entry per
  **space** — the a/b forms (OKLab, CIELAB, HelmGen) plus OKHSV/OKHSL — because a disc of
  a space and of its LCH twin is the same picture; a saved LCH id resolves to the twin.

  **Guide lightness (all pickers).** There is no global source setting. A model with
  `lightSource: 'native'` uses its own lightness axis (OKLCH/OKLab, CIELAB/CIELCH,
  HelmGen, future HCT/CAM16); the sRGB-relative OKHSV/OKHSL views use canonical
  OKLab `L`. `G.lightnessOf(model, axes)` returns that scalar;
  `G.setLightness`/`applyLightness`/`guideCurve` solve to it. A fixed plane/disc only
  has no contour when its fixed axis is that model's native light axis. A sample whose
  target is unreachable is dropped, never drawn along the panel edge. The line is red while
  locked. — main records a CSP **pick** (a change that supplies or changes the active slot's colour; an inactive-slot diff or a pure foreground/background switch adds nothing). A left-button release over CSP takes a fresh protocol read, so the newest tile appears on release with the exact last colour; a 450 ms settle covers picks with no pointer release (keyboard, hex, paste). **Record only while drawing** (one global setting, shown here) records only a non-Alt canvas contact: picks are noted, and the next canvas down takes a fresh read and adds the colour actually used. Every window only mirrors the shared list.
- **CSP Shortcuts** — CSP's own list is read-only. It reads only the current
  workspace `.spws` (falling back to `default.khc` only when that workspace has no
  table), shows the file's saved time, and has a Refresh button that re-resolves the
  current workspace. CSP may not write edits until the workspace is saved/closed.
  It resolves readable names (`csp-command-names.js`), groups commands vs tools, and filters by
  the next pressed shortcut. Tool/subtool names come from the Node databases; there is no brush-level
  shortcut to show.
  The **CSP** and **Iroiroppa** tabs share the module width equally; the **All**, **Command** and
  **Tool** filters keep their text width and stay on one line on a small screen. The
  **Iroiroppa** tab remains a compact mirror for the module command bindings and the
  General show/hide key; the full General/Palette manager is **Settings → Shortcuts**, where
  toggle, hold, after-pick, and appearance position are chosen. A binding whose
  normalized accelerator matches a CSP command/tool shows a clash warning
  (`shortcut-match.js`).
  When the folder cannot be found the module offers **Locate CSP data folder…**, and
  Settings → General carries the same pick: the CELSYS folder (which contains
  `CLIPStudioPaintVer…`) or the version folder itself. Empty means Auto (the default
  `Documents\CELSYS` and `Config.sqlite`'s custom path).


## 8. Modules in scope for the rewrite

| # | Module | Contents |
| --- | --- | --- |
| 1 | **Color Slices** | The model's three coordinate planes, named by their free channels (`L × C` / `H × C` / `H × L`, or `V × S` / … for hue-first models), in role order; each is hideable and reorderable in the module's settings and drawn flat — projections live in their own modules. |
| 2 | **Color Slider** | The active model's three axis sliders (L / C / H in OKLCH; horizontal ↔ vertical). |
| 3 | **Color Wheel** | ✅ A two-band hue ring (fixed outer reference + contextual inner ring) around the active model's hue slice; drag either band for hue and the inner shape for the rest. Inner rotate/flip and a hue-rotation slider; OKLCH shows the flat L×C slice with the working gamut's chroma axis; OKHSL uses the square-mode black-white side plus a vertical-moving cusp, OKHSV an equilateral inscribed triangle. |
| 4 | **Color Disc** | ✅ The hue × chroma plane on a circle with the third axis on a slider: round for OKHSV/OKHSL (relative s), lobed for OKLCH/OKLab (absolute chroma, the document gamut). |
| 5 | ~~Color Gamut~~ | **Not a module.** A gamut view is a slice of the profile with the silhouette Color Slices already draws — a second picker with the same data. The disc is a different geometry, not a fourth copy. |
| 5 | **CSP Color** | The foreground / background / transparent slots (row ↔ column). |

Everything else (header, banner, profile switcher, footer) is chrome — and since "One palette"
the banner, the profile switcher and the footer chrome are the `session` and `color-stat`
modules, so they are *not* window chrome any more.

The Modules tab groups these by the manifest's `group`: **Core** (Session, CSP Color),
**Color Picker** (Color Slices, Color Slider, Color Wheel) and **Utility** (Color Stat, Color History).
Each module's *default* is a hidden template: the tab lists and edits only **instances**,
and a new instance is added from the default with the ＋ row.

**Default layout:** one column containing `csp-color`, `color-slices`,
`color-slider` (top to bottom) — matching today's order, with all three named maps
inside `color-slices`.

## 9. Themes

✅

- The Appearance tab has a **theme dropdown**, populated from the bundled
  `themes/*.json` plus the user's `%APPDATA%\Iroiroppa\themes`.
- The main process reads the files (the renderer can't fetch under its CSP) and
  hands the token sets over IPC; `kernel/themes.js` applies them to the document
  element. A theme's `dark` flag drives `color-scheme` and the Settings window's
  OS background.
- The **accent is editable**: an in-app picker popup (saturation/value square,
  hue slider, hex field) with **Save / Cancel**, plus Reset to the theme's own
  accent; stored per theme in `settings.accents`. `--accent-weak` and the
  readable `--accent-text` are re-derived from the override.
- A stored `theme: "light"|"dark"` migrates to `default-light` / `default-dark`
  on load.
- **The token set is declared once** in `src/shared/theme-tokens.js` (label, type,
  default, where it applies), rendered into `docs/THEMES.md`, and checked by
  `npm test` and `npm run theme:check`; `npm run theme:preview -- <id>` renders a
  theme to a PNG. The `theme-authoring` skill is the workflow.
- **Bundled**: `default-light`, `default-dark` and `blender-dark` (Blender's
  default dark palette — the values and their source are in `docs/THEMES.md`).
- **Beyond colour**: a theme may ship a sibling `<id>.css`, injected after the
  base styles into every window, so radius, spacing, fonts and per-component
  styling are all themeable — not only colour. A theme's own fonts/images live in
  `<themesDir>/<id>/` and are served over `theme://`; the app bundles Inter and
  DejaVu Sans.
- **Paint vs structural.** Tokens carry a `kind`. A **paint** token (colour,
  `--shadow`, `--radius`) cannot change geometry. A **structural** token
  (`--font-ui`, `--mono`, `--font-size`, `--space`) can, so a change to one
  re-measures and re-clamps the window once (`theme-structural` →
  `Board#remeasure`). A theme's CSS may only paint; the `theme-check` budget
  rejects layout or per-frame properties on a bundled theme (`docs/THEMES.md`).

## 10. Migration from the current app

| Today | After |
| --- | --- |
| Slot strip (`#slots`) | `csp-color` module |
| Lightness + Chroma maps | `color-slices` module (+ Hue slice) |
| L/C/H sliders | `color-slider` module |
| Header / banner / mode bar / footer | the header stays chrome; the banner, the profile-switcher mode bar and the footer (swatch/hex/tools) are the `session` and `color-stat` modules |
| `theme` light/dark | theme id + theme files |
| `settings.json` | unchanged (global), plus `layout.json` and `modules/*.json` |

First launch with no `layout.json` writes the default layout above. Global
settings keep their existing file and keys.

## 11. Phased delivery

| Phase | Deliverable | Verification |
| --- | --- | --- |
| **0** | ✅ Kernel split; three modules rendered in one fixed column; Hue slice added. **Behaviour unchanged**, plus the new Hue strip. | `--shot` at 260 and 200; `npm test` green |
| **1** | ✅ Theme files + dropdown (accent editable) | `--shot --theme` for each theme |
| **2** | ✅ Per-module settings files + in-module gear popover | `--shot` with a settings toggle |
| **3** | ✅ Board: columns, column/module resize, `layout.json` | `--shot` at several sizes |
| **4** | ✅ Reorder drag (within/between columns); edge-drop makes a column | manual + `--shot` |
| **5** | ✅ Float action, float window, edge snap + dock | manual + `--shot` |
| **6** | ✅ Responsive orientations + drag-out-to-float / snap-to-dock | `--shot` at wide/tall boxes |
| **7** | ✅ Floats are boards (columns) and modules drag between windows (palette → float, float → palette/float, edge-drop makes a column); the palette-follow snap | `--shot` with `--float`/`--drop-float`/`--dock` |

Each phase is independently shippable and must leave `npm test` green and the
`--shot` workflow working.

## 12. Risks

- **Cross-window dragging** — the main UX risk; mitigated by doing the
  float *action* first.
- **Non-activating window + focus** — module popovers with text inputs must
  reuse the existing `setEditable` dance so they never steal focus from CSP.
- **CSP for user code** — deliberately out of scope; modules are bundled, themes
  and settings are data.
- **Performance** — file I/O is trivial; the watch items are DOM churn while
  resizing (use `ResizeObserver`, rAF-throttle) and the number of float windows
  (cap concurrent floats).
- **Minimum size** — at the 200 px minimum the board is narrow; every module
  must have a usable tall/narrow layout.

## 13. Open questions

- Hue slice: implemented as **hue across the horizontal, lightness down the
  vertical, at the current chroma** (a wide strip). Confirm the vertical axis
  reads as intended; refine in the polish phase if needed.
- None blocking.

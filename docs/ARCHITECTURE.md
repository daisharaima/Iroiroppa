# Architecture

## Processes

Electron's three usual contexts, deliberately kept thin:

- **main** (`src/main`) — owns the TCP connection, the screen capture, the
  foreground watcher, persistence and the window/tray.
- **preload** (`src/main/preload.js`) — a small `contextBridge` surface
  (`window.csp`). No Node in the renderer.
- **renderer** (`src/renderer`) — the popup UI. Owns all OKLCH state and the
  proof transform; talks to main only through `window.csp`.

`src/shared/color.js`, `src/shared/proof.js` and `src/shared/color-models.js`
are UMD modules so both the CommonJS main process and the renderer (as
`window.Color` / `window.Proof` / `window.IroColorModels`) can use the same maths.

## Connection lifecycle

```
main.js  ── creates ──▶  CompanionService (src/main/service.js)
                              │
                              ├─ pair()            scan the screen for the QR, then connect
                              ├─ pairWithPayload() connect from a URL/hex you provide
                              ├─ connectSaved()    reconnect with the stored password
                              ├─ readColor()       one SyncColorCircleUIState poll
                              ├─ writeColor(rgb)   coalesced SetCurrentColor
                              └─ selectSlot(slot)  activate foreground/background/transparent
                              │
                              └─ CompanionClient (src/main/companion/client.js)
                                     TCP framing, auth, heartbeat, request/response
```

`CompanionService` emits `status` and `color`; `main.js` broadcasts them to the
renderer over IPC (`companion:status`, `companion:color`).

### Polling

The host does **not** push colour changes, so the service polls
`SyncColorCircleUIState` adaptively: a 50 ms ticker that actually sends every
100 ms for ~1.5 s after any change, and every 300 ms when idle. Only one request
is in flight at a time. `_emitIfChanged` de-duplicates (1/255 tolerance) and
merges partial payloads into the last known state.

Reads only flow while the host's idle gate is cleared, and clearing it also stops
CSP pausing a document's worktime tracker — so polling is gated: the service
keeps the reset while the palette is visible and the machine has recent input
(`powerMonitor.getSystemIdleTime()`), and otherwise stops polling and sends empty
keep-alive heartbeats. The two sources are injected into the service so it stays
Electron-free; the gate and its constants are documented in `docs/PROTOCOL.md`
and `docs/INVARIANTS.md`.

### Writes

`writeColor` coalesces to ~1 update per 60 ms and marks the written value
"sticky" for 1.5 s: if a read-back still shows the value we replaced (CSP commit
lag), the service re-asserts the written value instead of letting the UI snap back.
Any other value is a real change — an eyedropper in CSP — and is accepted. Picks
made while disconnected are remembered and flushed on reconnect.

## Renderer state

```
mode      'default' | 'proof'      which colour pipeline is active
proof     Proof instance (or null) built from the selected ICC + model
slots     { main, sub, active }    CSP's three colours, for the header chips
L, C, H   the current colour, in the displayed (OKLCH) space
```

`readOklch` / `contentRgb` / `appearanceRgb` route the CSP↔OKLCH conversions
through the proof transform; `gamutInGamut` / `gamutMaxChroma` / `cmax` route the
gamut through it too. Everything else (the maps, sliders, chips) is derived from
OKLCH, so changing the profile or model only requires clearing the plot cache and
re-interpreting the stored colour.

## State model & session

A palette, its floats, Settings and the overlay are separate windows, so shared
state crosses a process boundary. A **canonical model** in main
(`src/main/state-hub.js`; domains in `src/shared/state-domains.js`) is the single
source of truth; each window mirrors it through `src/renderer/kernel/state-client.js`
and drives its views with pure adapters (`state-adapters.js`). A **peer layer**
(`src/main/peer-hub.js`; vocabulary in `src/shared/peer-events.js`) tracks which
windows are open and speaks a typed event vocabulary; `--peer-bus` (default on) adds
a `MessagePort` per window for transient traffic, and the compute host runs heavy
work in a supervised `utilityProcess` (`src/main/compute-host.js`). The IPC surface
is grouped into `src/main/ipc/` (`app`, `modules`, …) behind `src/main/ipc-sender.js`.
Settings live in `src/main/settings-service.js` (it owns `settings.json` and runs the
side effects); the high-churn colour history lives in `history.json`.
The full spec is docs/STATE.md.

## The window

The popup is `focusable: false`, so on Windows it is a non-activating window
(`WS_EX_NOACTIVATE`): clicks and drags arrive, but the window never takes focus
from Clip Studio Paint. Text fields temporarily enable focus and release it on
blur. Visibility is driven by `foreground.js`, which streams the foreground
process name from one long-lived PowerShell process; the palette shows while CSP
(not "every other app") is in front.

## Screen capture

`capture.js` has two backends: Electron's `desktopCapturer` (in the app) and a
PowerShell + `System.Drawing` BMP grab (for the headless probe). Both yield raw
RGBA that `jsQR` decodes, with a tile fallback for small QR codes on large,
high-DPI desktops.

## CSP shortcut storage

CSP stores its shortcuts as SQLite, not in the registry (verified CSP 5.0.4,
Oct 2026). The user-settings root is the CLIP STUDIO "materials location"
(`<Documents>\CELSYS`, or a custom path from
`CLIPStudioCommon\Preference\Config.sqlite` →
`CategoryFolderPath.DataFolderPath`), then `CLIPStudioPaintVer1_5_0\`:

- command shortcuts — `Shortcut\default.khc`
  (`shortcutmenu(menucommandtype, menucommand, shortcut, modifier)` +
  `shortcutinfo`);
- per-workspace shortcuts — `WorkSpace\workspace_*.spws`
  (`workspaceshortcutmenu` + `workspaceshortcuttool(uuid, shortcut)`), listed in
  `workspacelist.txt` with the current one named in `workspacelistinfo.spwi`;
- tool (subtool) names for a `workspaceshortcuttool` uuid come from
  `Tool\EditImageTool.todb` (`Node(NodeUuid, NodeName, NodeShortCutKey)`).

`modifier` is a Windows-style bitfield (4=Ctrl, 2=Shift, 1=Alt); `shortcut` is a
string (`F2`..`F12`, `DELETE`, `BACKSPACE`, `-`, single letters) or `NULL`. All are
readable with Node's built-in `node:sqlite` (Node 24) — no new dependency.
Factory defaults live in the install at
`<Settings>\PAINT\WorkSpace\Win\<lang>\presetWin_*.spws`.

## Persistence

`store.js` is a tiny JSON store. `settings.json` holds UI/behaviour settings,
`session.json` the rotated Companion password for reconnects. Both live in
`%APPDATA%\Iroiroppa` and are never committed.

## Architecture

```
src/main/
  main.js             Electron entry: window, tray, login item, IPC, dev flags
  preload.js          contextBridge API (window.csp)
  service.js          connection lifecycle, adaptive polling, coalesced writes
  history-recorder.js the one writer of the shared colour history (pure, testable)
  pointer-watch.js/.ps1  left-button down/up over CSP (canvas/Alt flags) for history
  pointer-history.js  the release/contact fresh reads (pure, testable)
  history-gate.js     the global drawing-only gate routing (pure, testable)
  capture.js          screen capture (Electron/PowerShell) + QR decode
  foreground.js/.ps1  foreground watcher (EVENT_SYSTEM_FOREGROUND hook; -Once query)
  overlay-menu-box.js overlay menu bounds: ten-row cap + scroll (pure, testable)
  window-bounds.js    per-monitor window placement (pure, testable)
  update-check.js     GitHub release check (pure, injected fetch)
  layout-store.js     layout.json v2 + the v1 -> v2 migration (Electron-free; fs I/O)
  drag-session.js     the drag phase machine: cursor poll, resolve, draw, commit, cancel (pure, testable)
  layout-service.js   the one writer: the workspace in memory, revision, debounced save
  layout-view.js      the transitional v1 view of the document (columns/floats);
                      still written by the float layer, and goes when that becomes an intent
  json-file.js        atomic JSON writes + a corrupt-file backup (pure, testable)
  module-store.js     per-module settings files (pure, testable)
  theme-store.js      bundled + user theme files: tokens, CSS and asset paths (pure, testable)
  user-module-store.js  user module folders + the module:// asset resolution (pure, testable)
  command-router.js   routes a module command to the window that mounts it (pure, testable)
  proof-profiles.js   colour-profile discovery for proofing (pure, testable)
  ipc.js              the renderer -> main IPC handlers (takes the app context)
  shot.js             the --shot driver (takes the app context)
  panes.js            the float layer: snap/dock/drop + the palette windows' hand-over
                      (the module-drag itself is `drag-session.js`)
  windows.js          palette/Settings/popout/overlay windows, tray, focus, auto-connect
  store.js            tiny JSON persistence
  portable.js         a portable build's data root: beside the exe (pure, testable)
  companion/
    client.js         TCP client: auth, heartbeat, read/write, slot selection
    packets.js        frame encode/decode
    crypto.js         the two XOR keys, password rotation
    qr.js             companion share-URL decode/encode
    commands.js       command names, enums, uint32 scaling
src/renderer/
  index.html, style.css           the popup chrome and board
  app.js                          kernel boot: board + the palette's own state
                                  (chrome is the session / color-stat modules)
  kernel/
    color-store.js                the colour state + proof/gamut routing
    command-bus.js                module commands: local dispatch + cross-window relay
    module-host.js                loads/mounts modules; header + settings popover
    layout.js                     the board: columns, resize, layout.json
    themes.js                     loads/applies theme token sets
    capabilities.js               mirrors main's live capability set
    capture.js                     opens and samples a captured window
    editable-fields.js             delegated focusability for text fields (a module's
                                    render() replaces fields after boot)
    settings-transfer.js            copy/paste a module's settings as a clipboard envelope
    i18n.js                        loads a locale catalog and applies data-i18n, dir=rtl
  selector_module/
    csp-color.js                  foreground/background/transparent chips
    csp-shortcuts.js              CSP's current-workspace command/tool shortcuts and the
                                  app-binding list (read-only for CSP, invokes on click)
    color-slices.js                Lightness + Chroma + Hue gamut slices (any model);
                                  each slice can be rotated/flipped for display
    color-slider.js               the model-axis sliders (per-channel gamut marking)
    color-wheel.js                hue ring + the model's hue slice inside it
    color-disc.js                 the hue x chroma plane on a disc: round for
                                  Okhsv/Okhsl (relative s), lobed for OKLCH/OKLab
                                  (absolute chroma, the sRGB gamut)
    color-history.js              recently picked colours
    color-stat.js                 the colour's numbers: swatch, HEX, OKLCH and sRGB
    session.js                    the singleton control panel: connection state and
                                  its light, the profile switcher, Settings
  themes/
    default-light.json            theme tokens (data; user themes live in
    default-dark.json             %APPDATA%\Iroiroppa\themes). A theme may add a
    blender-dark.json             sibling `<id>.css` (as blender-dark.css does) and
    blender-dark.css              a `<themesDir>/<id>/` folder for its own assets
  fonts/                          bundled Inter + DejaVu Sans woff2, with licences
  settings.html/.css/.js          the floating Settings window (Modules tab shows
                                  a live, pointer-inert preview per module)
  float.html/.css/.js             a floated board window (its own columns)
  module-settings.html/.css/.js   a module's settings popout (closes on blur)
  overlay.html/.css/.js             the drag chip: its own click-through window
src/shared/
  color.js            OKLab/OKLCH, sRGB, HSV, CIELAB, Okhsv, gamut maths (UMD)
  color-models.js     the colour-model views (OKLCH/OKHSV/Lab) over OKLab (UMD, pure)
  slider-gamut.js     hard-edged in/out-of-gamut slider stops (UMD, pure)
  slice-view.js       per-slice rotate/flip: forward draw + exact inverse pick (UMD, pure)
  shortcut-match.js   normalize CSP/Electron accelerators + find clashes (UMD, pure)
  module-usage.js     visible/hidden instance counts for the Modules light (UMD, pure)
  locale-names.js     endonyms and RTL set for the language picker (UMD, pure)
  icon-art.js         shared pastel big-I art for the exe/tray icon (UMD, pure)
  proof.js            ICC parsing + the appearance transforms (UMD)
  lut.js              N-D grid interpolation for the CMYK proof (UMD, pure)
  layout-model.js     the workspace document + its reducer (UMD, pure)
  layout-geometry.js  board sizing: column widths, module rects, min/content size (UMD, pure)
  drop-resolve.js     where a dragged payload lands: the one resolver for both the drop
                      indicator and the commit (UMD, pure)
  module-manifest.js  the one list of selector modules: ids + metadata (UMD, pure)
  capabilities.js     the capability model: channels + a module's availability (UMD, pure)
  i18n.js             the i18n core: interpolation + locale resolution (UMD, pure)
  locales/            one UMD catalog per UI language (en.js is the source; a locale may
                      omit a key, which falls back to English — `npm run i18n` reports coverage)
  synthetic-icc.js    builds the shipped synthetic ICC (scripts/make-icc.js)
  theme-tokens.js     the theming surface: every token's label, kind (paint/structural), type, default and use (UMD)
  theme-validate.js   theme checks: completeness, colours, text contrast, CSS budget (Node-only)
src/assets/
  synthetic.icc       the committed synthetic profile (first-run default)
scripts/
  probe.js            standalone client
  fake-host.js        a fake Companion host for UI work without CSP
  make-icon.js        build-time icon generator
  make-icc.js         regenerates src/assets/synthetic.icc (`npm run icc`)
  bench.js            headless micro-benchmarks (`npm run bench`, docs/PERF.md)
  theme-check.js      validate a theme against the token manifest (`npm run theme:check`)
  theme-docs.js       regenerate the token table in docs/THEMES.md (`npm run theme:docs`)
  theme-preview.js    render a theme to a PNG (`npm run theme:preview`)
test/                 node:test suites
```

Within the list, `pure` means *no Electron dependency and a headless test* — not
side-effect-free: the store modules still read and write files through an injected
path.

`src/shared/*` are UMD so both the main process (`require`) and the renderer
(script tag global `Color` / `Proof` / `ThemeTokens`) can use them. The exception
is `theme-validate.js`, which only main, the tests and the scripts use.

### main.js

`main.js` is orchestration: window lifecycle, tray, IPC wiring and boot. The pure
logic lives in the stores above — `layout-service`/`layout-store`/`layout-view`,
`module-store`, `theme-store`, `proof-profiles`, `window-bounds`, `update-check` —
each an Electron-free factory that takes the app-data directory (or a getter) and is
unit-tested headlessly. The layout's *pure* core (`layout-model`, `layout-geometry`,
`drop-resolve`) is shared with the renderer.

The rest of the planned split is done: `main.js` is now orchestration (boot,
flags, state, the `ctx` object, and the wiring of the stores and the `floats`/
`windows` factories), and every extracted module takes `ctx` (or an injected
directory) rather than reaching into globals. Verify boot and the UI after a
change with `npm start` + a `--shot` + `npm test`; the float/dock/overlay shots all
work.

The picker body is assembled from **selector modules** (`selector_module/*.js` —
classic scripts that register themselves on `window.Iro.modules` and are loaded
at launch) mounted by `kernel/module-host.js` into the board. Each module has a
header (name and drag grip); **right-clicking the grip** opens its settings in a
separate popout window (`module-settings.html`, which closes on blur) and
`ctx.settings.patch()` is persisted per module id (debounced).
Colour state and
the proof/gamut routing live in `kernel/color-store.js`; `app.js` only wires the
chrome. Modules adapt to their own box: `module-host.js` reports the body size to
`onResize`, and a module sets a `data-orientation` attribute its stylesheet
reacts to. A module's definition may declare **`minSize(settings)`** — the board
uses it to stop column dividers, module splitters and the window resize grip
before any module would be clipped. See `docs/MODULES.md` for the design and the phased plan.

The look comes from **themes**. A theme is a token set
(`src/renderer/themes/<id>.json`, plus the user's `%APPDATA%\Iroiroppa\themes`)
and an optional sibling `<id>.css`. Main reads both (`theme-store.js`), and
`kernel/themes.js` applies the tokens as a `:root` style block and injects the
theme's CSS **after** the base stylesheets, so a theme can restyle any component,
not just its colours (the Settings window's Appearance tab still just picks the
theme and overrides its accent, stored per theme in `settings.accents`; the
accent's readable ink is derived as `--accent-text`). Per-theme assets (fonts,
images) live in `<themesDir>/<id>/` and are served over the `theme://` protocol
(`src/main/main.js`); the app bundles Inter and DejaVu Sans under
`src/renderer/fonts/`. The token set is declared once in
`src/shared/theme-tokens.js` and rendered into `docs/THEMES.md`; `npm test` fails
if the manifest, the bundled themes, the renderer's CSS variables and the doc
disagree. `blender-dark` pairs Blender's palette with `blender-dark.css` (4 px
corners, its own font) — see `docs/THEMES.md`.

**User modules** are the same idea for code (`docs/USER-MODULES.md`): a folder
under `%APPDATA%\Iroiroppa\user-modules\<id>\` holding `module.js` (and an
optional `module.json` metadata file). `user-module-store.js` reads and validates
them; main serves the script and any assets over the `module://` protocol
(mirroring `theme://`, with the same escape guard), and each renderer registers
them into the shared manifest at boot (`window.csp.userModules()`), so the board,
the Settings list and the command bus treat them like bundled modules. A user
module is **unsandboxed** — it holds `ctx.csp` — which `docs/USER-MODULES.md`
states plainly. The directory is `user-modules`, deliberately not `modules` (the
latter holds per-instance settings JSON).

Tokens are split by `kind`: **paint** (colour, `--shadow`, `--radius`) never
changes geometry, while **structural** (`--font-ui`, `--mono`, `--font-size`,
`--space`) can change a card's measured size, so a theme change that moves one
fires `theme-structural` and the window re-clamps once. A theme's CSS may only
paint; `theme-check` rejects a layout or per-frame property on a bundled theme.


## Layout & windows

The board, the floats and every window are being unified: one workspace document
(a list of **palettes** — no main window / sub window split), one writer in main,
intents instead of mutations, and one drag session that draws the indicator and
commits the drop. `src/shared/layout-model.js` (the reducer),
`src/shared/layout-geometry.js` (the sizing maths) and `src/main/layout-store.js`
(the v2 store and the v1 migration) are unit-tested headlessly and wired up —
phase V1 of the plan in **`docs/LAYOUT.md`**, which is the
spec (schema, intents, units, the drag matrix, the phases) and the document to
read before changing any of this. `src/shared/module-manifest.js` (the one list of
selector modules), `src/main/json-file.js` (atomic writes + a corrupt-file backup)
and `src/main/layout-service.js` (the workspace document in memory, and the only
writer of `layout.json`) have landed too, and *are* wired up — phase V2. A board
addresses **its own** palette over `palette:columns:get/set` (resolved from the
sender), and the `layout` domain carries the v2 document; `src/main/layout-view.js`
is the **transitional** v1 view that main's float geometry still writes through
(`ctx.writeLayoutDoc` → `writeV1()`), and it goes when the last caller becomes an
intent.

## State on disk

`%APPDATA%\Iroiroppa\settings.json` and `session.json` (plus `user-modules/` for
user modules; see above). The latter holds the
rotated Companion session password — **never commit it**. Both are gitignored.
The optional `%APPDATA%\Iroiroppa\themes\*.json` folder holds user themes;
`settings.json` keeps the selected theme id and the per-theme accent overrides.
Each module's settings live in `%APPDATA%\Iroiroppa\modules\<id>.json`
(`{ "version": 1, "moduleId"?, "settings": { … } }`), where `<id>` is **the
instance** (post-N1): an instance with no file of its own inherits the module id's
file, so every pre-N1 setting carries over. The colour history is its own file,
`history.json`. The board structure is in `%APPDATA%\Iroiroppa\layout.json`:
**schema v2**, a list of **palettes** (`{ id, name, pos, size, collapsed, snap,
snapTo, columns: [{ id, width, modules: [{ instanceId, moduleId, height }] }] }`),
documented with its full shape in `docs/LAYOUT.md`. Main owns the file —
`src/main/layout-service.js` is the **only** writer — and a window addresses only
its own palette's columns through the sender-resolved
`palette:columns:get` / `palette:columns:set`; a float is just another palette, and
the old `float:columns:get/set` channels are gone.

**A portable build roots that same tree beside its exe.** electron-builder's
`portable` launcher exports `PORTABLE_EXECUTABLE_DIR` — the folder holding the
`.exe`, not the temp folder the app is unpacked into — and `src/main/portable.js`
points `userData` at `<that folder>\Iroiroppa Data` before `ready`;
`sessionData` (cookies and Chromium caches) follows it. The installed build,
dev runs and `pack:run` stay on `%APPDATA%\Iroiroppa`. A folder that cannot be
created or written falls back to the app-data path rather than failing every
store write. Because Electron keys the single-instance lock on the user-data
folder, a portable copy and the installed app can run at the same time.

**Named saved workspaces** live in `%APPDATA%\Iroiroppa\workspaces\<id>.json`
(`{ kind, version, id, name, savedAt, doc }`), written only by
`src/main/workspace-store.js`; `doc` is exactly the layout document, so loading one
reuses the `workspace.load` intent. Preferences can be exported/imported as a
`{ kind: 'iroiroppa-settings', version: 1, settings }` bundle (Settings → General).

The palette's placement lives in the **workspace document** (`docs/LAYOUT.md`):
`palettes[i].pos` is `x`/`y` in DIP plus the display it was last on, and
`palettes[i].size` is `width`/`height` in CSS pixels. `settings.json`'s
`windowBounds` is legacy — the v1 migration reads it (with the older `windowPos`
and `windowSize`) and nothing writes it any more. `src/main/window-bounds.js`
turns a stored placement into live bounds (see `docs/INVARIANTS.md`).


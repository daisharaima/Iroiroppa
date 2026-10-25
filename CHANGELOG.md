# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Two Helmlab GenSpace views.** **HelmGen LCH** (polar) and **HelmGen**
  (rectangular) join the colour-model list in Color Slices, Color Slider and Color
  Disc, with HelmGen LCH also in Color Wheel. They draw against the same document
  gamut as every other view; the picked colour, the CSP record and history are
  unchanged.
- **The portable build is self-contained.** It keeps its settings, saved pairing,
  layout, modules, themes and history in `Iroiroppa Data` beside the exe instead
  of `%APPDATA%\Iroiroppa`, so copying that folder carries the whole setup to
  another PC. A portable copy and the installed app no longer share data.
- **Color Slices projections.** Each map can be drawn `flat` (the unrolled
  rectangle), `polar` (hue on the angle, chroma on the radius) or `triangle` (the
  cusp frame, whose apex follows the hue). Display-only and invertible, like
  rotate/flip; offered only on maps that can carry the shape.
- **Color Wheel.** A hue ring around the model's hue slice; the ring is the most
  saturated in-gamut colour at each hue. OKLCH shows its flat L×C slice; OKHSV and
  OKHSL add a square ⇄ triangle switch (fixed corners for OKHSV, the cusp frame for
  OKHSL).
- **Color Disc.** The hue × chroma plane on a circle, with the third axis on a
  slider: a true circle for OKHSV/OKHSL (relative saturation), the lobed document
  gamut for OKLCH/OKLab (absolute chroma).
- **The model lineup is the OK family**: OKLCH, OKLab, OKHSV, OKHSL and OKHWB.

### Changed

- **Wide slices no longer show a lightness step.** Colours past sRGB are drawn as
  the sRGB-edge colour at the same lightness (`Color.fitToSrgb`), so a
  constant-lightness row stays even instead of stepping where the sRGB boundary
  crosses the slice. The picked and recorded colour is still the true wide-gamut
  one; only the pixels are a stand-in.
- **`Slider` is now `Color Slider`** — the name matches the other pickers in a
  float's title bar. The id and saved settings are unchanged.
- **Projections left Color Slices.** Each slice is drawn flat again; the polar and
  triangle frames moved to their own modules (Color Disc, Color Wheel) so a picker
  is one geometry instead of a per-slice mode.

### Removed

- **The "sRGB gamut warning" toggle.** Wide colours are now drawn with the
  lightness-preserving stand-in, so a hatch over them would only break the
  uniformity it was there to explain.
- **The HSV, HSL and CIELAB views** are gone: OkLab/Okhsl cover them with better
  uniformity, and the picker now only tours one perceptual family. Saved module
  settings that name one of them fall back to OKLCH.

### Fixed

- **A pick no longer rotates the hue when you release the slider.** The app
  broadcast every write back to its own window and re-read the 8-bit record as a
  new colour, moving H by up to a few degrees (worst at low chroma) and adopting
  the clipped record past the gamut. A window now ignores the records it just
  wrote; a real value from Clip Studio Paint still wins.
- **The palette stays on top again.** On Windows 11 build 26300 a non-activating
  window whose always-on-top request is dropped can never come forward — it sits at
  the bottom even when clicked. The app now re-asserts the topmost band itself with
  a `SetWindowPos` fallback (`src/main/topmost.js`) whenever Electron reports the
  window as not on top, so the palette and floats float above Clip Studio Paint
  again.

## [1.2.1] — 2026-10-23

### Fixed

- **Installing while Iroiroppa is open** no longer fails with "Iroiroppa cannot
  be closed". The installer closes the running app — including a copy started
  from another folder, such as the portable build — before replacing files.

## [1.2.0] — 2026-10-22

### Highlights

- **Color History is exact** — the newest tile is the colour you picked, and it
  appears on release instead of lagging one pick behind.
- **"Record only while drawing" is back** — an optional History setting records a
  colour only when a canvas contact uses it.
- **Faster, clearer settings** — browse for ICC profiles directly, search CSP
  shortcuts by pressing the shortcut, and copy/paste module settings as icons.

### Added

- **"Record only while drawing" is back**: an optional History setting records a
  colour only when a non-Alt pen/mouse contact on the CSP canvas uses it. It is one
  global setting enforced in main (picks are only pending; the canvas contact takes a
  fresh protocol read), so a second palette or float can never leak past it. Default off.
- **Copy/paste settings as icons**, and an **editable number** beside every Module Size
  slider (module popover and Settings).
- **A simpler pastel app/tray icon**: a rounded square with one big `I`, no colour wheel.
- **A real Browse action for ICC profiles**, in the Session picker and Settings → Proof
  Color, styled as a command rather than another profile row.
- **Search CSP shortcuts by pressing a shortcut**, with All / Commands / Tools & brushes
  filters and readable names (raw CSP ids stay in the tooltip).

- **Health domain.** CSP status, the compute host and the secret store publish to a
  `health` domain, and a compute-host exit raises a peer `error` event.
- **Canonical state model, session layer and adapters.** One versioned model owned
  by main, pure per-window adapters, and a typed session/peer vocabulary (a
  clean-room adaptation of token-beam's architecture — see docs/STATE.md and
  THIRD_PARTY.md). On by default; `--legacy-state` falls back.
- **Vendored culori** behind a guarded interop layer for CSS parsing, space breadth,
  interpolation and colour-difference, with a cross-check test against the core
  colour maths.
- **Capability layer.** Every window mirrors a live set of the channels the app uses
  to reach Clip Studio Paint, and a module declares what it needs. A missing
  **required** channel shows an "unavailable" card instead of a control that does
  nothing; a missing optional one degrades the module. `--capabilities` /
  `--cap-off` force a channel for a screenshot.
- **CSP Shortcuts.** A new selector module listing Clip Studio Paint's own command
  shortcuts and tool keys, searchable, and invoking one over the protocol (falling
  back to a native key send).
- **CMYK proofing.** LUT-based CMYK profiles are selectable and prove on screen:
  the proof shows what a colour would look like printed through the profile, while
  Clip Studio Paint's recorded values are left untouched.
- **Multi-language UI.** Settings → General → **Language** (or match the system).
  22 locales in `src/shared/locales/`: English plus French, German, Spanish, Italian,
  Portuguese (Brazil), Russian, Japanese, Korean, Polish, Dutch, Swedish, Danish,
  Finnish, Norwegian, Czech, Hungarian, Romanian, Turkish, Ukrainian, and Simplified
  and Traditional Chinese, each with an English fallback.
- **Palette & study tools** (Settings → Modules). **Picky Palette** — each colour
  claims the territory nearest to it, so moving one reshapes the map. **Colour
  Constructor** — harmonies, relative adjustments and a lighting preview.
  **Palette Tools** — polar (poline-style) palette generation. **Dither
  Calculator** and **Posterize / Dither** — split a colour into dithered stroke
  colours with a preview. **Painting Study** — a captured frame's lightness
  histogram and dominant colours.

### Changed

- **The profile menu shows ten full rows and scrolls** instead of squashing every ICC
  profile into the palette; a row never cuts its text in half.
- **The Slider's out-of-gamut marking is per channel and has a hard edge**, not a soft
  gradient. Its horizontal arrows are now left/right (vertical stay up/down), and Hue
  nudges by one whole degree.
- **The Modules tab's light reflects visible instances** live, including instances hidden
  from the palette; it stays an indicator, not a module-wide switch.
- **Auto-hide is instant**: `foreground.ps1` follows `EVENT_SYSTEM_FOREGROUND` and the
  palette hides as soon as CSP loses focus, with no debounce or PowerShell re-query. If
  the watcher is down, the palette stays up. Auto-hide toggled in Settings starts/stops
  the watcher immediately.

- **`npm run map` says what it saw.** The index now starts with `# N files, M indexed`,
  gains `--files` (every walked file, with hit and line counts), and indexes IPC
  registrations that follow another statement on the same line.
- **Text fields work after a re-render.** Focusability is one delegated listener per
  window (`kernel/editable-fields.js`) instead of per-node wiring at boot, so a field a
  module renders later is editable without a restart, and a click straight into another
  field no longer turns editability off.
- **Every palette is addressed by id (true equality).** A board reads/writes its own
  palette (`palette:columns:get/set`, the palette resolved from the **sender**), the
  `layout` domain carries the v2 document and each window picks its own palette out of it,
  and window operations, the tray and the module broadcast look a palette's window up by
  id (`windowForPalette`) instead of assuming `ctx.popup`. `float:columns:get/set` and the
  primary/floats split are gone from the board path; the column codec moved to
  `src/shared/layout-codec.js`. The transitional v1 view (`src/main/layout-view.js`) is
  still there, and still written by the float layer — it is what remains of the old path.
- Bumped Electron 44.4.5 → 44.6.0 (patch: Chromium/ANGLE/V8 fixes; no API change).
- Renamed the window-peer layer off the overloaded word "session"
  (`peer-hub` / `peer-events` / `peers`, IPC `peer:*`); split `ipc.js` into domain
  group files (`ipc/app|modules|layout|window|commands|settings.js`) behind
  `ipc/helpers.js` and `ipc-sender.js`; the layout domain is now consumed from the
  model instead of the legacy channel.
- Settings are owned by `src/main/settings-service.js`; `JsonStore` writes atomically
  (temp + rename); the colour history moved to its own `history.json` (migrated).
- **State/session defaults flipped on.** The canonical model, the peer `MessagePort`
  and the `utilityProcess` compute host are now the defaults; the legacy channels
  and the in-main decoder remain behind `--legacy-state`, `--no-peer-bus` and
  `--no-compute-host`. `session.json` is now encrypted at rest (`--no-secret-store`
  keeps it plaintext).

### Fixed

- **Color History no longer shows the previous pick**: history used to be recorded by
  every window's `ColorStore`, each with its own 450 ms settle. Chromium clamps a
  hidden window's timers to ~1 s, so a hidden palette or float could add an *older*
  pick after a newer one, and the head-only de-dupe accepted it. Main now records a
  `pick` from the Companion service, and a left-button release over CSP takes a fresh
  protocol read and commits that exact colour, so a CSP pick lands on release instead
  of one step (or 450 ms) behind; a 450 ms settle remains only for picks with no
  pointer release. Windows mirror `history:changed` and send only their own explicit
  picks. An inactive-slot-only partial is no longer a reason to record the old active
  colour either.
- **History updates at the 100-colour cap**: the settle path detected changes by
  array length, which stops changing once the list is full. It now emits whenever a
  colour is actually inserted, so the grid no longer freezes on the previous head.
- **History no longer lags one pick behind while the palette is hidden**: the grid
  renders synchronously instead of waiting for an animation frame that Chromium may
  pause for an occluded/auto-hidden palette. The data and the visible grid now move
  together.
- **A pick delivered with an active-slot switch now enters History**: CSP can send the
  newly picked colour and the foreground/background change in one payload. The store
  records it when that slot's colour actually changed; switching back to an existing
  slot colour still adds nothing.
- **Worktime pauses when you leave CSP again**: the heartbeat's idle reset now also
  requires CSP to be the foreground app, not just a visible palette and recent mouse
  movement elsewhere. The foreground watcher keeps running when Auto-hide is off so
  this stays accurate.
- **Newly added/shown modules get their own column** instead of being appended under
  the last module.
- **CSP Shortcuts reads only the current workspace**, shows when that file was saved,
  and has a Refresh button; it no longer mixes in default-only commands.
- **The CSP Shortcuts module was empty** because it read the shell's `Documents` folder
  (a non-default Documents folder on some machines) and the oldest CSP version folder.
  It now uses Electron's Documents path and the newest installed CSP version, and reads
  the current workspace's `.spws`.
- **Dynamic labels printed their raw key in English** (History's empty state, CSP
  Shortcuts' search) because the English catalog was never loaded before modules mounted.
- **CSP commands no longer show raw ids**; tool and subtool shortcuts are grouped and
  joined against CSP's real Node databases, so brushes/tools are discoverable.
- **The module popover's five actions are one row**, with a divider between the instance
  actions and copy/paste.

- **Palette drags no longer switch Windows to Do Not Disturb**: the drag overlay covers the union
  of the displays' work areas (never a whole display) instead of the whole desktop.
- **Auto-hide follows the foreground again**: a palette shown with the hotkey or the tray no longer
  stays up over every other app. With Auto-hide on, switching away from Clip Studio Paint hides it;
  turn Auto-hide off to keep it up.
- **Reconnect is quick and honest**: a dropped socket retries from 250 ms (5 s cap), a transient
  failure shows Reconnecting rather than Error, and auto-connect no longer starts a scan that tears
  the retry down. Coming back to CSP (or showing the palette) starts a scan at once.
- **The Session row says what the app is doing** while disconnected (Scanning…, Connecting…,
  Reconnecting…, Pairing failed, Disconnected); connected it still shows Clip Studio Paint.
- **The document profile picker is drawn by the overlay**, so it can leave the palette's bounds and
  scrolls when there are many ICC profiles; its browse row is just **Browse** and now actually applies
  the chosen file.
- **Settings reopens on the last tab used**, and the Modules tab is twice as tall.
- **A module's preview shows even with no instance mounted** (rendered from its defaults).
- **The Modules tab's green/grey light is an indicator, not a switch**: hide/show is per instance on
  the right, and it changes the palette immediately. The old module-wide toggle is gone.
- **Unsnap is a titlebar icon next to the hamburger** while palettes are joined; the hamburger no
  longer carries it.
- **A snapped pair resizes as one**: the shared edge acts as a splitter, so the edges stay flush.
- **A non-primary palette shrinks to its content**, so a width resize no longer leaves an empty band.
- **A palette name ellipsises only when it reaches the titlebar icons** (it used to stop at 11ch).
- **The Slider drags continuously and may leave the gamut**: only the nudge arrows round to the
  displayed precision; the Slices' crosshairs follow into the hatched out-of-gamut area, while slice
  drags still snap back.
- **The auto-connect loop and the focus watcher start a scan at once** instead of waiting for the
  next timer tick.

- **Clicking the Session dot (or the Settings Connect button) now starts a scan.** `startPairing` was
  never exported on the main context, so `companion:pair` threw "ctx.startPairing is not a function"
  and the dot did nothing.
- **The Settings module-wide disable wrote the legacy layout**, which a model-mode palette ignored —
  it only changed the right-hand list. The path is gone.
- **The palette's profile browse did nothing**: `proof:browse` returns a path string, read as
  `{path}`.
- **The Session profile popup could not leave the palette** and was clipped by its column.
- **A removed module's hidden instance could be shown again**; unknown hidden instances are dropped
  on load now.
- **A float with only natural modules kept its old height** after a resize.
- **The PowerShell capture fallback no longer blocks the app**: it ran on the main thread for
  ~2 s with `execFileSync`, freezing every window, the drag poll and IPC; it is now async.
- **A float window recovers like the palette**: a lost release or a blur clears the drag
  state (which otherwise stops it following CSP), a click closes the settings popout, and a
  language change takes effect.
- **Module settings saved from the palette or the popout carry their `moduleId`**, so Trash
  → Restore can put back the module they belong to (the Settings list already did).
- **The Settings detail refreshes after a module changes elsewhere**: the cache is keyed by
  instance while the broadcast carries the module id, so the old invalidation missed.
- **A re-render keeps the selection honest**: the rebuilt board prunes ids that no longer
  exist and repaints, instead of leaving an invisible set a plain press would drag.
- **A queued colour survives a dropped socket** instead of being recorded as written: the
  next reconnect flushes it.
- **The window no longer fights its own minimum at a fractional UI scale** (1 px slack), and
  an auto-fit that could not be applied no longer looks like a user edge-drag.
- **The module-settings popout survives being replaced.** The old window's `closed`
  handler cleared `moduleSettingsWin` unconditionally, so opening a popout for another
  module left the new one unreachable (`resize`/`close`/blur did nothing). Each window now
  guards the shared reference.
- **Packaged builds unpack `foreground.ps1`.** PowerShell cannot read inside `app.asar`, so
  follow-focus silently failed in the installed app; `asarUnpack` now covers
  `src/main/*.ps1`.
- **A Quick Access NAK no longer looks like success.** The client resolves any reply, so
  `DoQuickAccess` returning an ERROR packet made `csp:invoke` skip the key-send fallback.
- **Cancelling a QR scan during the capture actually cancels it**, and a superseded scan's
  exit can no longer clear the scanning flag a newer scan is holding.
- **A module-command reply is accepted only from the window the call was sent to**, and a
  stale `unregister` no longer deletes an instance a float has since re-registered.
- **`module:changed` reaches each float once** — `paletteWindows()` already includes them.
- **Pure white is inside the proof gamut.** The matrix proof normalises the record white to
  the profile's own white; it previously sat at rec ≈ (1, 1, 1.0006), just past the 1e-5
  relative tolerance, so #FFFFFF read as out of gamut. The LUT proof is unchanged.
- **Neutral greys keep their hue anchor.** The store's achromatic gate is now 1e-6 (as the
  slices already used) — an RGB grey arrives with C ≈ 2e-8, so a 1e-9 gate never engaged and
  the hue read ≈ 90°.
- **Hidden modules keep their settings.** The startup sweep and the Trash list built their
  keep-ids from the raw `hiddenInstances` entries, which are `{instanceId, moduleId}`
  objects — so every hidden instance's settings file looked unused and was swept after the
  trash window (or immediately by Trash → Purge). Both now use `LayoutModel.liveInstanceIds`.
- **A splitter drag survives a size-only layout push.** `_retune` now re-points each mounted
  record at the document's live model object, so a drag after a Module Size / weight change
  updates the document instead of a detached copy (which the save then discarded).
- **Renaming a palette reaches main.** The blur handler pre-set `_paletteName` before calling
  `setPaletteName`, whose no-change guard therefore always hit; the rename was never sent
  and a failure could not revert.
- **A settings push no longer resets the connection row.** The Settings window re-ran
  `i18n.use()` on every push, rewriting `#settings-state` / `#btn-conn` back to
  "Not connected" / "Connect"; it now switches only when the language changed and repaints
  the status after.
- **The pre-theme font size exists.** `--font-size: var(--font-size)` was self-referential
  and invalid at computed-value time, dropping every `calc(var(--font-size) …)`.
- **Colour edge cases.** `gamutMap` clamps `L` at zero chroma; `inGamut` agrees with
  `chromaIntervals` at L=0/1; `rgbToHsl` reports white as unsaturated instead of s≈1; the
  hue view prints H0 rather than H360; the wheel's slice cache keys on hue and L; and a
  picky-palette click at the right/bottom edge can no longer read transparent black.

- **A float (a module dragged into its own window, or a duplicated palette) rendered the
  source palette's modules under the same instance ids** — so deleting one deleted it in
  both. The `layout` domain carries the whole workspace, where `columns` is the *primary*
  palette's; a float board now picks its own columns out of the document (main used to
  send the per-window columns on the legacy channel).
- **Uncaught main-process crash ("Object has been destroyed").** `broadcast` sent to a
  window whose webContents was already destroyed (a float docking, a deleted palette).
  Every send now goes through `src/main/broadcast.js`, which checks the window *and* its
  webContents and never throws, and `state-hub.set` can no longer be aborted by a failed
  broadcast — the root cause of the drag/drop, empty-space and resize symptoms.
- **Colour picker snapping back mid-drag.** The grace window now suppresses the whole
  write burst (our latest value, earlier writes, and the value we replaced) and still
  accepts a real change made in Clip Studio Paint.
- The `utilityProcess` compute worker is unpacked from `app.asar`, with an in-main QR
  decoder fallback, so packaged pairing cannot break.
- Stale `state:changed` revisions are dropped, so a delta that races the hydrate
  snapshot is no longer clobbered.
- Privileged IPC channels (colour writes, layout/settings/module changes) now
  resolve and validate their sender, and `color:write` rejects non-numeric channels.
- A colour echo is suppressed only when it matches the value we wrote or the value we
  replaced, so a real CSP change inside the grace window is no longer stomped.
- **A module could vanish from a palette and leave a band of empty space.** Mounting a
  module is asynchronous, so a layout change arriving mid-mount re-rendered the board under
  the loop and the card was appended into a detached element; because the module was already
  recorded as mounted, nothing ever re-mounted it (Color Slices was the visible loss). A
  column pass now checks that it still owns its element before and after each mount.
- **The palette could shrink its own width.** The board's content fit moved the height on its
  own, and a request below the window's minimum came back clamped — a height the board never
  asked for, which it then read as a user dragging the bottom edge and answered by scaling the
  width down (300 px wide became 168). A fit is no longer mistaken for a drag.
- **A v1 document lost its locked ratios on the way into schema 2.** The migration read a
  module's `weight` but ignored the v1 `ratio`, so a saved board (or the screenshot recipe)
  came back with every locked-ratio module at its default height.
- The `--shot`, theme-preview and packaged-app launchers no longer inherit
  `ELECTRON_RUN_AS_NODE`, which made Electron run as plain Node (a `--shot` run crashed and
  `pack:run` reported success while launching nothing), and a `--shot` run no longer takes the
  single-instance lock — it used to capture the user's own open window instead of its own.

### Removed

- **Ten selector modules were removed** because they were not ready for this
  release: Color Gamut, Color Wheel, Palette Tools, Picky Palette, Capture Color,
  Colour Constructor, Dither Calculator, Painting Study, Posterize / Dither and
  Value Checker.

## [1.1.0] — 2026-10-04

### Highlights

- **More colour models** — OKLCH, OKHSV, HSV, HSL and CIELAB, each a view of one
  canonical colour.
- **A Color Wheel and a Color Gamut disc** — two new ways to pick from the
  working gamut.
- **Lightness guides and an sRGB gamut warning** — see equal-lightness lines and
  where the profile exceeds sRGB.

### Added

- **Colour models.** The two picker modules (the slice and the slider) can show
  OKLCH, OKHSV, **HSV**, **HSL** or CIELAB. A model is a *view* over one shared
  canonical colour value, so switching loses nothing and everything downstream
  (proof, history, snapping) is unchanged. The picker's settings → **Model**.
- **Lightness guide lines** on the non-OKLCH models: the whole slice is gridded at
  the **Guide spacing**; while dragging, the guides become relative to the current
  colour (its lightness and ±5% / ±10% neighbours) and a **red line** marks where
  the drag began, until release. The line colour eases between light and dark with
  the surface behind it.
- **sRGB gamut warning** — a hatched overlay on colours the working profile holds
  but sRGB clips (the picker settings → sRGB gamut warning; off by default).
- **Color Wheel** — a new selector module: a **hue ring** with the active model's
  **Hue Slice** inside (OKLCH: L×C; HSV/HSL: S×V / S×L). Available in
  Settings → Modules → Picker.
- **Color Gamut** — the working gamut as a polar **hue × chroma** disc (angle = hue,
  radius = the chroma/saturation axis) with the remaining axis on a slider.
- **Editable colour values.** Each slider row's number is a text field, and the
  arrow keys nudge by one display unit.
- **Copy / paste module settings** — from a module's ⋯ popup, copy all of a
  module's settings or everything except the colour model, and paste them onto
  another.
- **Saved workspaces** — snapshot the whole layout under a name and load, rename
  or delete it later (Settings → Layout). **Settings export/import** backs up or
  moves your preferences as one JSON file (Settings → General).
- **A global summon hotkey.** Settings → General → Behaviour has a hotkey field: press the keys and the
  palette shows or hides from anywhere, even while Clip Studio Paint has focus. A modifier is required
  (or a function key), a key another app already owns is refused rather than remembered, and Esc clears
  it. Empty by default.
- **User modules.** Drop a folder into `%APPDATA%\Iroiroppa\user-modules\<id>\` (`module.js` plus an
  optional `module.json`) and the app loads it like a bundled one — the manifest, the Settings list and
  the command bus all see it. Served over a `module://` protocol with the same escape guard as themes;
  a user module is unsandboxed (it holds `ctx.csp`), which `docs/USER-MODULES.md` states plainly.
  `examples/hello-module/` is a working sample.
- **Per-module command shortcuts.** Settings → General → Module shortcuts lists every command the
  mounted modules expose and lets each be bound to a system-wide key (its own field, same rules as the
  summon hotkey). A key another app already owns is refused rather than remembered, and the binding is
  stored in `settings.commandBindings`.
- **A module command bus, and the Value Checker module built on it.** A module can expose named
  commands (its `create(ctx)` returns a `commands` map) that another module calls by *instance id*
  through `window.Iro.commands`; main routes a cross-window call and correlates the reply
  (`src/main/command-router.js`, docs/MODULES.md "Module commands"). The first consumer is **Value
  Checker** — a read-only module showing the colour's perceptual lightness (OKLCH L) as a painter's
  0–10 value, with a neutral grey chip at that same lightness and the stored HEX.

### Changed

- The canonical colour value is now **OKLab**, with OKLCH a derived view — an
  internal refactor with no visible change (`docs/COLOR.md`).
- The picker modules are named for what they are, not a model: **Color Slices**
  and **Slider**, and their **ids** were renamed to match (`color-slices`,
  `color-slider`) — a saved layout or settings file under the old ids migrates on
  read.
- **Every slider axis greys its out-of-gamut region**, not just chroma. Dragging
  into the grey keeps the marker there but clamps the colour to the nearest
  in-gamut value, so one row never changes another. Each value has **spinner
  arrows**, and the settings call the rows **1st / 2nd / 3rd channel**.
- **Colour history** holds up to **100** colours (set per instance), scrolls when
  the box is too short.
- On a model whose axes can leave the working gamut (OKLCH, Lab), a slice's
  out-of-gamut area is a faint hatch. **HSV, HSL and OKHSV are dense** — every
  axis value maps to a colour — so they show no out-of-gamut area at all.
- Dragging a slider, slice or wheel no longer rebuilds the raster maps at full
  resolution: they render at a reduced scale mid-drag and sharpen on release.

### Fixed

- Mounting or dragging the **Color Wheel** no longer stalls: the hue ring was
  rebuilding by asking the gamut for its max chroma once per ring pixel (~100 ms
  at 300 px, ~4× that at 2×). It now samples that on a 0.5° grid, so the ring is
  unchanged but the rebuild is a few milliseconds.
- On a model other than OKLCH, dragging in one slice now updates the other slices
  live (they render at a lower resolution during the drag and sharpen on release).
- Dragging a slice's chroma — or the chroma slider — to zero no longer jumps the
  hue: the anchor is kept where chroma is undefined.
- **The Settings window can no longer open blank if the app was running from before an update.** The
  user-module list was read over a *blocking synchronous* IPC at renderer startup; a main process that
  did not answer — e.g. an instance still running from before the update — left the Settings renderer
  frozen white. The list now arrives as a window argument, so no renderer ever waits on IPC for it.
- **A dragged module keeps its size, and a palette keeps its width.** A palette no longer re-scales
  its own width when the board grows or shrinks the window itself: that programmatic resize was being
  misread as a top/bottom edge drag, which shrank a multi-module palette and left it unable to shrink
  back after a module was dragged in. A module dragged out to its own window is now exactly that
  module's size (the window was opened 12 px too wide, which the locked ratio then made taller).
- **The palette's minimum size is small again, so it can be shrunk.** The window's minimum had been set
  to the content height, which stopped the palette shrinking at all. It is back to the modules' own
  floors, and a top/bottom-edge drag scales the width (the height then follows the width, catching up
  on the pass after the resize grace). Main no longer
  resizes the palette on a module add/remove behind the board's back — the board fits its own content —
  which is also what lets it tell a user edge drag apart from its own resize.
- The `--drop-none` / `--board-drag` dev flags work again (`ctx.drawnBoxFor` was never exposed).

## [1.0.0] — 2026-10-03

### Highlights

- **Locked-size modules** — every module keeps a width:height ratio, and the
  palette fits its content.
- **Themes do more** — light, dark and a Blender-inspired theme can restyle
  layout and fonts, not just colour.
- **Faster, more reliable connecting** — Iroiroppa reads the Companion QR from
  the dialog itself.

### Added

- **A Blender-inspired dark theme, and a theming surface that cannot silently lie.** `blender-dark`
  matches Blender's default dark palette (the `#303030` greys and the `#4772b3` selection blue). Every
  token is now declared once in `src/shared/theme-tokens.js`, rendered into `docs/THEMES.md`, checked by
  `npm run theme:check` / `theme:preview` and guarded by `npm test`, so a hand- or AI-written theme fails
  loudly instead of rendering something wrong.
- **A theme can now restyle everything, not just colour.** A theme may ship a sibling `<id>.css`,
  injected after the base stylesheets, and its own fonts/images from a `<themesDir>/<id>/` folder
  served over a `theme://` protocol. The app bundles **Inter** and **DejaVu Sans**, and the Blender
  theme uses them with 4 px corners for a genuinely Blender-like look. See `docs/THEMES.md`.
- **Tokens are split paint vs structural, so theming stays cheap.** Colours, `--shadow` and the new
  `--radius` never move layout; `--font-ui`, `--mono`, the new `--font-size` and `--space` can, and a
  change to one re-measures and re-clamps the window exactly once. A theme's CSS is held to a budget
  (`theme-check` rejects animation, filters and layout properties on a bundled theme), so a theme
  cannot cost per-frame work. See `docs/THEMES.md`.
- **The colour card tells you how far the current colour is from the last one.** A `ΔE` row under the
  coordinates, with a small swatch of the colour it is measuring against — the difference in **OKLab**,
  which is honest to label as such (a full CIEDE2000 buys very little at the extremes for four times
  the code). It reads the shared history, so it needs nothing new from main.
- **The card says when its own numbers describe two different spaces.** The swatch and the sRGB row are
  the colour **on screen**; the HEX and the L/CH row are what the document **stores**. With a proof
  profile active they genuinely differ (they always did — the tooltip was the only place that said so),
  so a `≠` marker appears beside them, each row carries a tooltip naming its space, and the marker
  disappears when the two agree.

- **A Trash for settings files nothing uses.** Deleting a palette or an instance keeps its
  `modules/<instanceId>.json` so a mis-click stays recoverable — which would otherwise leave files
  behind forever. Settings → Modules has a bin button at the bottom that reveals a **Trash** section:
  the unused files with their age, and a button to remove them. Unused means the id is neither a
  module in the manifest nor an instance in the workspace (placed **or** hidden); a module's own
  defaults are never touched. Files older than **30 days** are swept at startup on their own.
- **One palette: every palette is the same kind of window now.** The first palette's private
  chrome is gone. The connection light and banner, the profile switcher, the mode bar and the
  whole footer are **modules** any palette can hold: **`session`** (the only singleton — connection
  status and its light, Connect/Disconnect, Scan QR, the profile switcher, and the way into
  Settings) and **`color-stat`** (the swatch, the HEX with copy/paste/edit, OKLCH and sRGB). The
  tray menu gained a **Settings…** item and the per-palette gear is gone, so Settings no longer
  lives in the first window. Two behaviours moved rather than disappearing: the hex field's
  copy/paste (into `color-stat`) and "choosing a profile turns proofing on" (into `session`). The
  layout-lock button is dropped — locking is the setting it always was — and the crosshair toggle
  remains a Settings row.
- A workspace written before those modules existed gains them **once**, recorded in the document
  itself (`seeded`), so an upgrade loses nothing and a module you deliberately removed is never
  re-added.
- **Snap zones.** Every palette (and lone module) shows four accent bands — one per edge — while
  you drag; dropping into one joins the dragged palette to it, flush, and the two become a group.
  A zone holds one palette, so the bands it takes disappear. Dragging any member's header moves
  the whole group; a module still drags by its own header. Joining is now *only* this gesture: the
  old proximity snap and the automatic join when a palette opened beside another are gone, so
  nothing joins by drifting close.
- **Instance controls** in Settings → Modules: **+ Add** mounts another instance of a
  module, **Duplicate** starts a second instance from the settings of the one you have
  selected, **Hide** keeps an instance (and its settings) but mounts it nowhere — it stays
  listed in the strip as `#N · hidden`, with **Show** to bring it back — and **Delete**
  removes it for good. The last module in the workspace cannot be hidden or deleted.
- **Settings → Layout**: every palette listed with its module count, an inline **name**
  field, **Duplicate** (a second window with the same modules, each getting its own
  settings), and **Export… / Import…** for the whole workspace. Import accepts an old
  `layout.json` too, migrating it on the way in.
- **Module settings are per instance** now: a second copy of a module keeps its own
  settings (`modules/<instanceId>.json`), falling back to the module's own file for
  anything it has not changed. The module's gear and the Settings → Modules pane edit the
  instance you have in front of you.
- **The gear in any titlebar opens Settings** (the palette's moved into its titlebar, and
  floats got one), and a module that allows only one instance says so.
- **Shift-click selects a range of modules and a drag carries the whole selection** — the
  order runs down the columns, Ctrl/Cmd toggles one module, and a plain press keeps a
  selection so it can be dragged as one payload.

### Changed

- **The Session row's controls are larger** (24 px buttons, 15 px glyphs, up from 20/13), so the one-line
  module is easier to hit; its minimum height follows (28 → 32 px).
- **Settings → Modules is grouped and instance-first.** The list is split into Core (Session, CSP Color),
  Color Picker (OKLCH Slice/Slider) and Utility (Color Stat/History) from the manifest. A module's
  *default* is now a hidden template — the tab lists and edits only instances — and each instance is a
  row with a green (shown) / grey (hidden) circle plus a ＋ row that adds an instance from the default.
  Delete/hide an instance from its own ⋯ popup.
- **The Trash previews and restores.** Settings → Modules' bin shows each leftover settings file with a
  **Preview** (the stored JSON and the module it belonged to) and a **Restore** that re-creates the
  instance with those settings; the Settings window grows to show the list. A file written before this
  release records no module, so it can be previewed but not restored.
- **Settings → Layout is per-palette and icon-first.** Each palette row has an expand arrow, its name, its
  module count and duplicate / export / delete icons (the old "Duplicate" text button is gone). Expanding
  lists the palette's modules, each with disable / pop-out / remove icons; the Palettes header imports a
  single palette, and the whole-workspace Export/Import sit on one line.
- **Modules have a locked size, and the palette fits its content.** OKLCH Slice, OKLCH Slider and Color
  History now take their height from the column width times a per-instance ratio (the defaults keep the
  old look), set with the new **Module Size** slider in Settings → Modules. A palette whose modules all
  fit their own size is exactly as tall as its tallest column, and grows when the content does.
- **Orientation is a setting, not a guess.** OKLCH Slice, OKLCH Slider and CSP Color take a horizontal /
  vertical setting per instance; the old “taller than wide → vertical” auto-flip is gone, so a resize
  never turns a module under the pointer.
- **CSP Color is a locked-ratio module too**, so it has its own **Module Size** slider (Settings → Modules
  and its ⋯ popup) like the pickers. The default is a thin strip.
- **A palette always shows every member.** Its height is its content height — the modules' ratios derive
  it from the width — so a height-only resize can no longer clip the bottom module; the window grows and
  shrinks onto the tallest column.
- **Duplicate and delete an instance from the Modules tab**, beside its name (delete asks twice), as well
  as from the module's ⋯ popup. The tab now re-reads the layout on `layout:changed`, so a module deleted
  or duplicated in another window updates the list.
- **One column per palette.** Side-by-side columns are gone — a palette always holds a single column, and a
  legacy multi-column document collapses to one when it loads.
- **The palette ⋯ menu gained a Settings entry**, and **a Module Size drag no longer flashes the board**: a
  size-only change re-tunes the cards in place (instead of rebuilding them) and the palette window re-fits
  to its content, so a live drag leaves no whitespace and clips nothing. A palette also resizes when a
  module is dragged in or out.
- **The Module Size slider can go down to 0.05×** (was 0.2×), so a thin strip like CSP Color can be made
  thinner.
- **Dragging a palette's top or bottom edge now resizes it** — the width scales with the height, so the
  palette keeps its width:height ratio instead of the drag doing nothing.

- **The palette menu now opens outside the palette.** A window cannot paint past its own edge, so an
  in-window menu could never cross the palette's boundary (the user's report). The menu is drawn by the
  **overlay window** instead: main moves that always-on-top surface to the button and shrinks it to
  exactly the menu, so the menu can sit over the desktop, over another palette, anywhere — proven by
  geometry (`overlayBounds {x:854,y:325,w:132,h:104}` vs `paletteBounds {x:700,y:300,w:200,h:340}`:
  the palette's right edge is 900, the menu runs to 986). Its clicks are turned on only while a menu is
  open (`setIgnoreMouseEvents(false)`), and anything outside the menu stays outside the window, so no
  other click is intercepted. Rename / Lock / Unsnap / Delete moved with it; Delete still asks twice.
- **The one-line rows are tighter, so the whole reading fits a small window.** The hex field is 8ch and
  the data cell a size smaller, the rule between the two sections keeps its 1px line but loses its wide
  padding, and the swatch is 16px — the sRGB view (`R239 G20 B134`) no longer truncates at 200px.
- **One-line modules are header-only now.** A module can declare `compact`: its card head is drawn as
  an **overlay on the right end of its own row** instead of as a row above the content, so Session and
  Color Stat cost exactly one line each — the title row is gone, the ⋯ (which is also the drag gripper)
  floats over the row, a press anywhere else on the row drags the card, and the controls inside keep
  their own clicks. The card's minimum height no longer counts a head for them.
- **Second device pass on the Session row and the card minimums.** The Session card keeps its own
  header again (its absence was the "why did the header disappear" report) and its row is
  `● Clip Studio Paint … [◐ profile] [lock] [⚙ settings]`, with the icons hard against the right edge
  and a **proper gear** (the first one read as a sun). The accent is now a faint wash that fades out
  instead of a solid tint with a bar, which looked like an admonition box. The **layout lock** joined
  it next to the proof icon, and the palette hamburger gained the same Lock/Unlock entry. The
  **per-module settings entries left the palette hamburger** — each card's head has its own ⋯, and the
  list was long enough to overflow a narrow window.
- **A one-module window is that module's window**: its header shows the *module's* name (not a palette
  name that says nothing for a single card) and carries a **⋯ that opens that module's settings**, which
  the headless card inside does not have.
- **Minimum sizes are smaller by request**: a module's floor is now 75% of its comfortable width and
  **half** of its height (head included). A module dragged under its comfortable size has to shed
  parts rather than clip — `color-stat` is the first to do it.
- **The palette menu is no longer cut off by the window**: it is fixed-positioned, scrolls when it is
  taller than the window, and a long label ellipsises instead of widening it. Long module settings rows
  were the reason it overflowed.
- **A module instance can be deleted from its own settings**: the popout gained "Delete this module…",
  which asks twice, works for a floated module too (deleting is about the instance, not about where it
  sits) and shows the workspace's reason when it refuses — the last module cannot be removed.
- **The Session module is one row, and its profile list is complete.** `● Clip Studio Paint
  [profile ▾] ⚙` — the dot is both the connection state and the action (click it to pair when idle or
  failed; while connected it does nothing, so a stray click cannot drop the session), and the
  Connect / Scan QR / Settings buttons are gone. Disconnect lives in the module's own ⋯ panel and in
  the tray. The profile dropdown now asks main for a **fresh scan** instead of the cached list — the
  reason it was missing ICC profiles that Settings could see — with the default entry pinned first and
  the document's own profile shown even when the list does not carry it.
- **Sizes follow one rule, both ways.** A new column adds the dropped item's drawn width (plus the
  8 px seam), a row adds its drawn height (plus the gap), and taking either out gives it back; a
  docked palette adds its own width or height by which edge it lands on. Windows shrink now as well
  as grow (clamped by the board's minimum) — before, a window only ever grew, so a few drags
  inflated it. A drop into another palette's column no longer widens the window, and a move out of a
  column no longer stretches the ones left behind.
- **Snapping is simple again.** Drag a palette's titlebar and the window **moves with the
  pointer** — you see where it lands, so nothing is hidden and no outline stands in for it. On
  release it **joins the nearest edge of another palette within 14 px** (flushing against it, the
  two forming a group) or comes free; **released over another palette it docks** into it, with the
  drop indicator shown while the pointer is there. A **module's own header always drags the
  module** now, in every window — a lone module's header used to lift its window instead.
  The snap *zones* (four bands per palette) and the chip-only palette drag are gone.

- The README's AI disclosure says plainly that the project is vibecoded — AI-written
  under human direction — instead of describing it as "AI assisted".
- Dragging is smoother: the colour history and the L/C/H slider gradients update
  at most once per frame instead of on every internal change.
- Settings → Modules previews now match each module's default size: a short CSP
  Color strip, a 90 px slider, three Colour History rows, and every OKLCH Slice
  panel. The README screenshot uses the same sizes.
- The palette's colour-profile hint wraps onto its own line in a narrow palette
  instead of being squeezed to one word per line.

### Fixed

- **Connecting is reliable and near-instant.** A scan now finds the Companion dialog window itself
  through a long-lived PowerShell helper (Win32 `EnumWindows`), which reads the QR from that window's
  rectangle in ~80 ms once warm — far more reliable than a full-desktop sliver and fast enough to catch
  the QR almost the moment the dialog opens. The dialog is found **by process, not by window title**, so
  it works in every CSP language (and the Chinese *Udongman Paint* build); the title is only a secondary
  signal. The desktop is the fallback, every third pass. Auto-connect starts ~0.1 s after disconnect and
  polls about every 0.15 s.
- **A module can no longer be dropped onto a palette's vertical edge.** The drop resolver no longer
  returns a "new column" target for the outer edge or a seam: a drop anywhere in a palette lands in its
  one column at the pointer, and the vertical-edge indicator is gone (the palette-to-palette **snap** line
  stays). This also fixes a palette whose minimum size grew after such a drop and could not be shrunk.
- **The titlebar name can no longer be highlighted.** The name field ignores the pointer until Rename is
  chosen, so a drag on the header never starts a text selection.
- **The palette menu no longer hides behind the palette** (it is raised above it), and it closes when the
  palette does.
- **The Session gear is a symmetric gear**, not a lopsided sun.
- **The module ⋯ no longer sits flush against the card's right edge**; it keeps the card's own padding, so
  it looks balanced.
- **A palette shrinks to its content.** A palette holding only rigid/natural modules (a lone Session
  row) kept its old window height and left a band of empty space under the card; the board now
  measures the content and shrinks to it, lowering the palette's own 340 px minimum while it does. A
  board with a filling module is untouched.
- **The Session profile switcher lists every profile again.** `proof:list` returns a bare array, but
  the popup unwrapped `out.profiles`/`out.items` (both undefined), so only the pinned "Default sRGB"
  row ever reached the list.
- **The Companion QR is found in about a second, not five.** A scan captured every display at full
  resolution and decoded each (~4.8 s a pass); it is now capped at 1280×800 with the cursor's display
  decoded first (~1 s a pass), and auto-connect takes its first scan ~0.2 s after disconnect and polls
  every 0.4 s.
- **Unsnap is offered on a palette that has joined another.** The palette menu re-reads its snap state
  when it opens instead of using the value cached at bind time.
- **A press on a module header drags it; only the ⋯ opens its settings.** It used to open the settings
  popup on a press-and-release.
- **A drag can no longer land on the open palette menu.** Starting a drag closes it, so the indicator
  is not painted over the menu and the menu is not read as a drop target.
- **The `--shot` UI check is clean.** Every `.module-head` clipped by 3 px — the ⋯ button kept the base
  `margin-right: -3px` after the head override shrank it to 16 px, so its box poked past the head; the
  bleed now lives on the head itself. The connection dot was a 7×7 button; it is now a 15×15 hit area
  around the same 7 px dot. And a cramped slider could shrink below its own 13 px thumb (7 px measured
  at a 200 px window); the track now keeps a 12 px floor while still scaling with the row above it.
- **The light theme's error red missed AA on the light background** — 3.9:1 on the danger buttons
  (Quit/Forget) and the destructive menu items. `--error` is now `#c62828` (>4.5:1); the dark themes
  keep their brighter red.
- **Two Settings controls were 10.5 px micro-text** ("Check for updates" and the "newer release"
  notice); both are now the theme's base size.
- **Four dead theme tokens are gone.** `--titlebar-bottom`, `--footer-top`, `--footer-bottom` and
  `--grip` were declared and shipped in every theme but no stylesheet used them; the new token test
  caught them.
- **A lone module is a palette again, and it drags like one.** A one-module window used to hide its own
  header and show the bare card, so dragging it was a module drag. It now keeps its palette shell — the
  header, the hamburger, the eye — and the module inside mounts **headless**, which is what stops a
  header appearing inside a header. Dragging it is the palette drag: the window follows the pointer,
  the name chip says what is moving, and nothing hides.
- **The name chip names what is being carried from the first tick.** It was blanked while the pointer
  was still inside the source palette, which made a drag look like the module had vanished.
- **A module's minimum height now includes its head.** The board added the module's own minimum without
  the card header, so a splitter drag (or a smaller window) could crop the head or slice the row under
  it — the clipping in the screenshot. The head is measured from the live card, and a headless module
  adds nothing, which is how Session stays exactly one row.
- **Every palette's hamburger lists the settings of its modules.** Each card's head keeps its own ⋯,
  but a lone module has no head to click, so the palette menu now carries a "…settings…" entry per
  module it holds (rebuilt on every open, so it can never name a module that has moved).
- **No more listener leak, and no more flashing while dragging.** The host mounted modules again on
  every board rebuild and never released what they held, so their subscriptions piled up until
  Electron reported *"MaxListenersExceededWarning: 11 companion:status listeners"*. The host now calls
  each instance's `destroy()` (and disconnects its `ResizeObserver`) before a rebuild, `session`
  subscribes once per window, and a board no longer re-renders a layout identical to the one on
  screen — which is also what made every card flash during a drag, since a drag pushes a layout on
  every commit. Verified with the new `--listeners` flag: `{status:2, settings:2, color:1, layout:1}`
  at boot and **identical after six layout changes**.
- **No more empty palette when you empty the first one.** The primary palette is the first in the
  workspace; dragging its last module out made another palette primary in the workspace but left the
  main window still drawing the emptied one — an empty palette on screen. The window now follows the
  workspace: the palette that took over loses its own window, the main window rebinds (and adopts
  its geometry) — verified by moving every module out of Palette 1 and by a relaunch.

- **Docking a palette no longer duplicates its modules.** Docking used an old handshake that
  re-added each module with a *new* instance id, so every dock created a duplicate — in a stray
  palette that stayed open holding the copy — and instances multiplied across sessions. All three
  dock paths now use the same intent a drag does, so a module keeps its id and the emptied
  palette closes.
- **Every palette looks the same now.** A float's header is the palette's header — same
  markup, same stylesheet rules — so a palette that is not first has the badge, name, gear
  and eye instead of a bare grip, and a palette holding a *single* module no longer hides
  its header entirely.
- **The Settings gear works again.** The titlebar's move handler swallowed the pointerdown,
  so a real click never became a click. (The earlier check passed because a synthetic
  `.click()` skips pointer events entirely.)
- **Cross-palette dragging works.** A module drag now captures the pointer, so releasing the
  mouse outside the window it started in still ends the drag and commits the drop. It used
  to leave the drag running: no drop, a stuck grabbing cursor, and the next drag committing
  the stale plan.
- **Palette numbers stop climbing** — a new palette takes the smallest unused "Palette N"
  instead of a counter that only ever grew (1, 34, 36, 43…).
- **A window stays where you put it.** A float used to be pulled flush against the
  palette's edge on *every* move while it was near, so once it came close you could not
  drag it away again. Only the edge hint remains; a move never repositions a window.
- **A module dropped into empty space lands where you dropped it**, instead of at the
  app's fallback position just right of the palette.
- **The drag chip names what it is carrying again.** It read a generic "Module" because
  the name lives on the card and the drag starts on the card's header.
- **A float no longer docks itself the moment it opens.** Its placement emits a window
  move, and the dock-armed timer treated that as the user dragging it onto the palette —
  so a window that opened where the palette is (a duplicate, or a restored layout) was
  docked and its modules handed to the palette about a third of a second later.
- A window **fits the columns it holds**: inserting a column grows it by that column (plus
  the seam between columns) and a column leaving shrinks it by the column's measured
  width, so the columns that remain keep their size instead of stretching. A column-in,
  column-out cycle is exactly reversible. A move inside one window changes no size at all.
- A module dragged out into its own window **keeps its identity** (it used to be
  re-created, so anything that remembered it forgot it), and the palette no longer
  shrinks when a module leaves it — the columns refill instead.
- Dragging a module is now one path in the main process: the drop **indicator is
  drawn in a single always-on-top layer** that also carries the chip, so it is never
  clipped by the column it is in and never hidden behind another window — including
  when the drop lands in a *different* window (verified: dragging a palette module
  onto a float moves it, and the float re-renders to show it).
- Every window now shows and can **rename its own palette name** (click it in the
  titlebar, or the float's grip, and type) — names are saved with the layout, so a
  window comes back as "Left Dock" or "Palette 2". The app name no longer appears
  in a window's header; Settings shows "Iroiroppa v…" instead.
- The layout and window architecture is being rebuilt as **one workspace document
  in which every window is a palette** — no main window / sub window split — with
  a single writer, intents instead of mutations, and one drag session that draws
  the drop indicator and commits the drop. The first step has landed: the pure
  model (`src/shared/layout-model.js`), the board sizing maths
  (`src/shared/layout-geometry.js`) and the v2 store with a lossless v1 migration
  (`src/main/layout-store.js`), all headlessly tested and **not wired up yet, so
  there is no behaviour change**. The spec — schema, intents, the drop matrix and
  the remaining phases — is `docs/LAYOUT.md`.
- The Settings window shows the app's version in the General tab.
- Settings → Modules now shows a live preview of each module, so turning one off
  is not guesswork (the per-module settings popout shows none).
- Settings → General says when a newer release is available, with a link to it.
  The check stays silent when GitHub is unreachable.
- Settings → General has a **Check for updates** button (it reports "Up to date"
  when there is nothing newer).
- A fresh install without a Windows Adobe RGB (1998) profile now starts on a
  synthetic ICC the app ships, so proofing can be tried immediately (and the
  test suite uses the same profile).
- A float can be collapsed to a compact bar with an eye button (in its grip, or
  a lone module's header), without closing it.
- Cross-window drags now show the insertion line in the destination window, so
  the landing spot is visible before releasing.
- Dragging a whole float onto the palette (or another float) now respects where
  you drop it: onto a column body it merges its modules into that column, and on
  a seam — including the outer edge of a single-column palette — it inserts the
  float's own columns there, growing the window to fit. The target column is
  boxed for a body drop; a seam shows the insertion line.
- The tray's **Bring floats back on screen** returns a float stranded by an
  unplugged monitor.

- A collapsed **palette or float** stays collapsed after a restart (before, the
  state lived only in memory, so it came back expanded), and a collapsed float
  reopens with its real size intact.
- A float that was flush **above or below** the palette now reattaches when the
  app restarts and follows the palette when it moves; before, only a float attached
  to the left or right edge came back.
- `layout.json` now has a single writer in the main process (atomic and
  debounced), so two windows can no longer read-modify-write the file and one of
  the two layout changes silently win. An existing `layout.json` is upgraded to
  the new format on first run — the board itself is unchanged.
- A `layout.json` that cannot be parsed is kept as `layout.json.bak` instead of
  being silently replaced by the next save, and every layout save is now written
  atomically, so an interrupted save can no longer leave a truncated document.
- Clip Studio Paint's per-document worktime tracker pauses again while Iroiroppa
  is connected. The Companion heartbeat now asks CSP to reset its idle timer
  only while the palette is on screen and the machine has recent input, and
  sends plain keep-alive heartbeats otherwise — so the connection stays up but
  CSP can stop counting when you step away.
- The palette no longer gets stuck parked after a scan: the resize path (a park
  fires one, and so does a monitor DPI change) is muted like the move path, an
  overlapping manual/auto Connect can no longer capture the parked spot as the
  place to return to, and a hung or empty screen capture now times out and falls
  back to the PowerShell backend instead of leaving the palette parked.
- Auto-connect connects again when the QR is on screen: a saved pairing whose
  password CSP has rotated no longer retries forever — after a few failed
  reconnects it falls back to idle and scans for the new QR.
- The gamut maps no longer draw the sRGB primaries as unreachable: the boundary
  is drawn from the in-gamut chroma intervals, so the thin fin out to a primary
  corner (blue) is shown, and an out-of-gamut chroma between body and fin snaps
  down to the body instead of jumping up onto it.
- The palette reopens on the monitor it was last on: the saved display is
  remembered by id, an unplugged one falls back to the cursor's/primary, and the
  window is clamped into a live work area so it can never reopen off-screen.
- A stale pairing reconnect (or any failed attempt) can no longer disconnect a
  live connection: a late failure only reports if it still owns the client.
- Auto-connect is no longer blocked for up to a minute while a saved pairing
  dials dead addresses — each candidate now times out after a few seconds.
- The palette no longer "teleports" to the right edge after a scan: the
  temporary move is not remembered as the window position and is always undone.
- A slow first colour read can't drop a connection that just authenticated.
- A colour picked in a floated module (OKLCH Slice, OKLCH Slider, Colour History)
  is now sent to Clip Studio Paint. A float has its own colour store and was
  never marked connected, so its writes were queued and never flushed — the CSP
  Color module only appeared to work because it selects slots directly.
- Settings → Modules previews show each module's **default** state, so OKLCH
  Slice always shows every panel (including Chroma Slice) no matter which slices
  the user has currently switched off.
- The Settings window's module-name column now grows only as far as the longest
  name needs (up to half the window) and the settings column no longer gets a
  horizontal scrollbar.

## [0.10.0] — 2026-09-28

The first public release: a modular, themeable OKLCH picker for Clip Studio
Paint, connecting as the phone side of Companion Mode. Licensed
GPL-3.0-or-later.

### Highlights

- **The first release** — a modular OKLCH picker that connects to Clip Studio
  Paint over Companion Mode.
- **Live two-way sync** — drag a map or slider and CSP follows.
- **Proofing through an ICC profile** — keep the recorded value distinct from
  its appearance.

### Added

- **CSP Color** — Clip Studio Paint's foreground / background / transparent
  slots, with the recorded hex (what CSP stores) and the shown hex both visible.
- **OKLCH Slice** — Lightness × Chroma, Chroma × Hue and Hue × Chroma gamut maps,
  drawn from the active gamut and the selected ICC profile.
- **OKLCH Slider** — L / C / H sliders that turn vertical when the module is
  taller than it is wide, with a percentage thickness (100% makes the tracks
  touch). The layout is designed so no empty space is left in a column.
- **Color History** — recently picked colours, shared across every window.

Each module has its own settings (right-click its title bar) and each can be
turned on or off from the Settings window's Modules tab.

- Columns: add, resize, reorder; drag modules within and between columns, drop on
  an edge to make a column, and drag out to a float.
- A float is a board of its own: drop modules into it, arrange columns, drag them
  back. Floats snap flush to the palette's edges (all four) and follow it. A
  float holding one module is shown as a single bare card.
- Layouts are remembered between launches.

- Themes are JSON token sets: a light and a dark theme ship with the app, and
  your own can be dropped into the themes folder in AppData. The accent is
  editable per theme, with a readable ink colour derived automatically.
- The Settings window covers connection and behaviour (General), theme, UI scale,
  crosshair and module names (Appearance), and the module list (Modules).
- Colour proofing through an ICC profile, keeping the recorded value and its
  appearance distinct.

- Scan the Companion QR on demand, or let auto-connect watch the screen for it
  (locally only, never saved). The palette is non-activating, so it never steals
  focus from Clip Studio Paint.

### Fixed

- Tracking of gamut and layout state across profile changes, window resizes and
  module drags — see the test suite for the invariants.

[1.2.0]: https://github.com/daisharaima/Iroiroppa/releases/tag/v1.2.0

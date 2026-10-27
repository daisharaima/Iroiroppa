# Invariants — regression details

The always-on **core** of these rules lives in `AGENTS.md` → *Invariants*; this
file holds the detailed notes for everything else. Read the relevant group when
you touch that area — each entry is still an invariant, and the *why* is what
stops it coming back. Add new entries here; only promote one to `AGENTS.md` if a
plausible refactor silently breaks it (that is the test for the core list).

## Connection & service

- **`CompanionClient.close()` settles an in-flight `connect()`** (each dial also
  has a short timeout). Otherwise a teardown leaves the `connect()` promise
  pending forever and `service.start()` never reaches `idle`, so auto-connect
  never arms.
- **A failed first colour read must not tear down a connection** that
  authenticated — the read is a convenience, not part of pairing.
- **Parking the palette off the QR never changes the remembered position.** The
  move handler is muted while parked (`popupParked`/`parkReleaseAt`), and the
  position is restored even if the palette was hidden mid-scan; otherwise the
  next launch "teleports" the palette to the scan spot. The **resize** handler
  must be muted too — a park (or the DPI change from crossing monitors) fires a
  resize, and saving that writes the parked size/position. `withPopupParked` is
  re-entrant (a depth counter): a manual Connect arriving inside an auto-connect
  park must not capture the parked position as the place to return to.
- **A scan must always be able to finish and unpark.** The screen capture is
  bounded by a timeout and falls back from Electron's `desktopCapturer` to the
  PowerShell backend, so a hung or empty capture cannot leave the palette parked
  indefinitely (the probe uses the same PowerShell backend).
- **A saved pairing whose password CSP has rotated cannot re-authenticate.**
  After a few `reconnect-failed` events the service tears the client down and goes
  `idle` (`MAX_RECONNECT_FAILURES`), which re-arms auto-connect so it scans for the
  new QR; retrying forever leaves the app stuck in `reconnecting` and starves the
  scan even though the QR is on screen.
- **The heartbeat's idle-timer reset is conditional.** The
  `{"IdleTimerResetRequested":true}` payload is what un-starves `Sync*` reads, but
  it resets the *same* idle timer CSP uses to pause a document's worktime
  tracker. Sending it on every heartbeat (the naive "just always include it"
  fix) makes that tracker count nonstop. `CompanionService#_mayKeepHostAwake`
  keeps the reset only while the palette is visible, **CSP is the foreground app**
  and `powerMonitor.getSystemIdleTime()` is below `SYNC_IDLE_LIMIT_S`; otherwise
  `_pollTick` stops polling and the client sends empty heartbeats, which still
  keep the TCP connection alive. The service takes all three sources as injected
  functions so it stays Electron-free and testable (the defaults keep it active).
  A visible palette over another app must stay passive.

## Windows & placement

- **The palette remembers its monitor.** The workspace document carries the display
  id (`palettes[i].pos.displayId`; `settings.json#windowBounds` is migration-only
  now), and `src/main/window-bounds.js` resolves it to live bounds: it falls back to
  the cursor's (else the primary) monitor when the saved one is gone, and clamps the
  window into that monitor's work area. Never `setPosition` a saved
  record directly — that is how the window reopens on the primary (or, with an
  unplugged monitor, off-screen). Display add/remove/metrics events re-clamp the
  live window for the same reason.
- **Floats are brought back on demand, not automatically.** The tray's *Bring
  floats back on screen* calls `panes.js#reclampFloats()`, which pulls every
  float into a live work area. It is deliberately a user action (the palette's
  own display-change re-clamp stays automatic); a module floated onto an
  unplugged monitor would otherwise be stranded with no way to reach it.

## Colour & slots

- **`selectSlot` tolerates a cached slot with RGB but no HSV** (derive it from
  the RGB). Otherwise, after a couple of picks, slot switching silently dies.

## Layout & floats

- **A collapsed window remembers the expanded size, never the collapsed one.** The palette's resize
  handler must not write its live (bar) height into `popupDesign` while the document says the palette
  is collapsed, `saveWindowPlacement` sends no size then, and main applies the collapsed height before
  the window is used — otherwise the bar's height becomes the remembered size (and `Math.max(340, …)`
  turns that into a 340 px window with a band of empty space). The float has the same rule
  (`panes.js`: "Main must not remember the collapsed size as the float's own").
- **Deleting keeps a file; the Trash removes it.** A palette or instance deletion keeps its
  `modules/<instanceId>.json` (recoverable), so unused files are cleared on request in Settings →
  Modules → Trash and swept at startup when older than `TRASH_DAYS` (30). "Unused" = not a manifest
  module id and not an instance in the workspace, placed or hidden.

- **A rebuild must release what a module holds.** The host mounts a module again whenever a board
  re-renders, and throwing the DOM away does not undo its subscriptions — so the host calls
  `instance.destroy()` (and disconnects the record's `ResizeObserver`) in `reset()`, and a module
  that subscribes to IPC or to the colour store must implement `destroy()`. Skipping this is how a
  renderer ended up reporting *"MaxListenersExceededWarning: 11 companion:status listeners"* after a
  few drags. `session` subscribes **once per window** (`shared.wired`) and removes only its own
  per-mount callbacks; check any module with `--listeners`, which must not grow.
- **An identical layout is not re-rendered.** `applyLayout` compares the incoming view with the one
  on screen and returns when they match: a drag pushes a layout on every commit, and rebuilding for
  the identical ones made every card flash while something was dragged.

- **The primary is `palettes[0]`, and the shell window must follow it.** A drop that empties the
  first palette promotes another one (the document order does it), and the shell window has to
  rebind — otherwise it keeps drawing the emptied palette's columns and sits there as an **empty
  window**, which is exactly what a user sees as "an empty palette appeared". Main watches
  `palettes[0]` after every commit (`syncShellPalette`), closes the promoted palette's own window
  and reloads the shell.

- **One size rule, in `fitPane` (main).** A new column adds the dropped item's *drawn width* + the
  seam (8); a row adds its *drawn height* + the gap; a column that leaves subtracts its drawn width
  + the seam; anything else that leaves subtracts its drawn height + the gap. A docked palette uses
  its own window width (a vertical edge) or height (a column). Windows grow **and** shrink (clamped
  by the board's reported minimum), so a drag cycle returns to the same size. Do not bring back
  grow-only fitting: a palette that never shrank inflated with every drag, and moving a module into
  another palette's column used to widen the window by the item's width.

- **One header for every window.** A float uses the palette's own header markup and classes
  (`.titlebar`, `.brand`, `.title-actions`, `.icon-btn`) rather than a grip of its own, and a
  single-module palette keeps that header — there is no "bare card" mode. Anything that
  styles a window's chrome belongs in `style.css`, shared; only what is genuinely
  float-specific (the OS drag region, hide-while-over-the-palette, collapse) lives in
  `float.css`.
- **A drag captures its pointer** (`setPointerCapture`) once it actually starts, in both
  drag paths, with `lostpointercapture` ending it. A cross-window drop releases outside the
  source window by definition: without capture the `pointerup` never arrives, the drag never
  ends, and the next drag commits a stale plan. Never remove this to "simplify" a drag.
- **A window fits the columns it holds.** A column entering grows the window by that column
  plus the 8 px seam; a column leaving shrinks it by the column's *measured* width (main's
  board report, not the document's hint), so a column-in/out cycle is reversible. A move
  inside one window fits nothing, and a palette left with no columns closes instead.
- **A dragged window is made invisible with `setOpacity(0)`, never `hide()`.** A hidden window
  receives no pointer input, so the `pointerup` that ends the drag never arrives: the chip stays on
  screen, the windows stay invisible, and no drop destination can work. An opacity-0 window still
  hit-tests, so the gesture completes; the stall watchdog is the backstop.
- **Snap joining is the `snap`/`snapTo` attach graph.** A group is its connected component, and a
  zone is occupied by the anchor's side plus the attached palette's opposite side — nothing else is
  stored. Joining happens *only* by dropping in a zone: the proximity snap and the join-on-open
  were both removed. A lone module in a group shows its palette container (the `float-attached`
  body class), so its container drags as a window and its module by its own header.
- **Every move goes through `layout.place`, docking included.** `dockFloatModule`,
  `dockFloatAll` and `dockFloatAt` build that intent; nothing hands modules to another window's
  board. The old `module:accept` / `module:accept-float` handshake re-added each module with a
  **new instance id**, so every dock duplicated it and left a stray palette holding the copy —
  that is how a workspace grew to dozens of instances. Those channels now have no sender at all, and
  the renderer receivers are gone with them (`kernel/layout.js`); do not reintroduce one.
- **A new palette's number is the smallest unused "Palette N"** — never a persisted counter,
  which ratcheted (1, 34, 36, 43…).
- **A hidden instance keeps its instance id**, so its settings (`modules/<instanceId>.json`)
  come back untouched when it is shown again. "Hidden" means *mounted in no column and
  recorded in `hiddenInstances`* — never a flag on a placed module, so the geometry, the
  board and the v1 round trip need no special case. The list is pruned by `normalise` (an
  entry that is placed again, or whose module is gone, is dropped), and the last module in
  the workspace can be neither hidden nor deleted.
- **`module.enable` may be given an instance id** (main mints it so it can copy the settings
  of the instance being duplicated before the module is mounted). One that is already in use
  is ignored rather than reused.

> **Read `docs/LAYOUT.md` first for anything layout- or window-shaped.** The rules
> below describe the v1 implementation (`kernel/layout.js`, `panes.js`) and stay
> true until each is replaced — the rewrite keeps the *intent* of every entry here
> (notably "nothing may leave empty space") while moving its enforcement into the
> pure model and geometry layers. When a phase lands, move its rule to
> `docs/LAYOUT.md` rather than deleting it.
>
> **What the rewrite has already replaced** (V1–V6, see `docs/LAYOUT.md`):
>
> - **The drop indicator** is no longer drawn by the target board: the overlay
>   window draws it with the chip, so it is never clipped by a column or hidden
>   behind another window. A drag is main's session (`begin`/`drop`), and the v1
>   machinery for it is **deleted** — `_updateDropTarget`, `_drop`, `_dropExternal`,
>   `moduleHover`/`moduleDrop`, `hoverModule`, `float:add` and the cross-window
>   accept handshake.
> - **Geometry and window sizes are main's**: the palette's placement is document
>   state (`palettes[i].pos`/`size`), `palette.open`/`close`/`fit` effects open,
>   close and grow windows, and `settings.json#windowBounds` is migration-only.
>   The rules below about the *renderer's* weights and `refreshSizes` still describe
>   how a board lays itself out; what they no longer describe is who decides.
> - **The document is the truth for what a window holds**: boards report what they
>   drew (`board:metrics`), and a board's own `_save` still writes `columns` through
>   `layout:set` — transitionally, until the last of it becomes intents.
> - **Collapse and snap are persisted** for the palette and for floats
>   (`palette.setCollapsed`/`setSnap`), and a float's id is its palette id.
>
> Known doc bug: the entry mentioning `_fitLoneFloat()` names a function that does
> not exist; the lone-module content fit is `docs/LAYOUT.md`'s `isContentFit`.

- **Module headers drag modules in a float too.** The float window is moved by
  its slim `#float-grip` strip, not by the module headers.
- **A lone module keeps its palette shell, and the module inside mounts headless.** A one-module
  window shows its own header (grip, hamburger, eye), so dragging it is the *palette* drag — the
  window follows the pointer, the name chip says what is moving, and nothing hides — and the module
  is mounted with `headless: true` so a module header can never appear inside a palette header. This
  replaced the "a lone module is a bare card" mode (`body.float-single` hiding the grip): the user
  asked for the container back, and a bare card had no drag affordance of its own.
- **The drag chip names what is being carried from the first tick**, including while the pointer is
  still inside the source palette. Blanking it there made a drag look like the module had vanished.
  (The *card* still hides only once the pointer leaves — a different rule for a different question.)
- **A module's minimum height includes its card head, and both floors are *small* on purpose.**
  `_minHeightOf` is the module's own content minimum **+ the head measured from the live card** (0 for a
  headless module), and the sum is then **halved**; `_minWidthOf` is 75% of the module's comfortable
  width. Both numbers exist so a card *can* be squeezed; a module dragged under its comfortable size is
  expected to shed parts rather than clip (`color-stat` does), and the alternative — a large floor — is
  what made every card feel stuck. The head is still counted, because omitting it is what let a
  resize crop the head or slice the row under it.
- **A one-module window's header says the module's name and carries its ⋯** (`_headerName`,
  `_applyLoneHeader`): a palette name tells you nothing about the single card inside, and a headless
  card has no ⋯ of its own. The window is still a palette in every other respect — its grip drags it
  like a palette, and the palette menu lives in the same header.
- **A `rigid` module keeps its own height even alone in a column** (`_isRigid`, Session). This is the
  one deliberate exception to "nothing may leave empty space": the column carries the slack instead
  of stretching the module, which is what had made Session two rows tall.
- **The palette hamburger carries Rename / Lock / Unsnap / Delete — no per-module settings entries.**
  Each card's head has its own ⋯, and listing every module's settings in the menu made it long enough
  to overflow a narrow palette window. The menu is fixed-positioned and scrolls, so it can never be
  clipped by the window that owns it.
- **A window closing mid-drag hides the drag chip** (`closeFloatWin` calls
  `hideOverlay()`): a float can disappear while one of its modules is being
  dragged, and the chip would otherwise stay on screen forever.
- **The drag chip is its own window** (`overlay.html`, transparent, click-through,
  always on top): a chip inside the dragging window would be clipped at its edge.
  Positions come from the renderer in CSS pixels, so main scales them by the
  window's zoom.
- **The snap/edge indicators are pushed, so they can arrive before a board
  exists.** A fresh float is told its edge once its page loads, and each board
  also asks with `edge:get` — otherwise a half-built board misses the push.
  They are also **transient**: `flashEdgeHints()` shows them while a window is
  being dragged and clears them 500 ms after the movement stops.
- **A float created while locked sets its own resizable state** — it is not in
  `floatWins` yet, so `applyLocked()` has not reached it.
- **A module keeps its size when it moves between boards.** `_dropExternal` sends
  the module's rendered height with `module:drop`; `_acceptModule` turns it into
  the weight that renders at that height in the *target* column, and a new float
  is created at the module's size.
- **A drop back onto the source window is refused** (`module:drop` compares the
  target's webContents with the sender and answers `none`): the renderer then
  keeps the module. Without this, dropping a lone float's module on its own edge
  removed it from the float, which closed the window and lost the module.
- **A float hides its own contents while it is dragged over the palette**
  (`float:hide-dragging` → `body.drag-hidden`), so the drop target and indicator
  stay visible; it comes back if the cursor leaves or the drag settles. The
  palette *moving* a snapped float must not trigger this, hence `lastFollowAt`.
- **The float-single rules live in `float.css`, not `style.css`.** Both files are
  loaded by float.html with `float.css` last, so an equal-specificity
  `body.float-window #app` border/background beat `body.float-single #app` and
  every lone float grew a visible outer container.
- **The drag chip calls `moveTop()`** as well as being `screen-saver` level, so it
  stays above the palette and every float window.
- **Snapping covers all four edges** (`SNAP_TOL = 8`, chosen so it is not too
  magnetic), and the float's move handler must not `return` after snapping: the
  snap branch used to bail out, which skipped the "hide while over the palette"
  logic exactly while a float was dragged onto the palette. A lone module's own
  drag hides its window from the renderer (`body.drag-hidden`) because that
  window stops moving once the module takes over. **All four edges are restored on
  launch** now: only left/right used to feed `floatSnap` on reopen, so a float
  flush above or below the palette came back unattached.
- **Cross-window drags show a drop indicator in the destination window.** A
  drag that leaves its own window sends `module:hover` (screen coordinates) so
  main forwards it to the window under the pointer, whose board draws the line
  or edge via `_updateDropTarget`; main clears every other window first. The
  dragged window itself is passed as `excludeWin` to `windowAtPoint` — it
  overlaps the palette while its module is handed over, so without the exclusion
  the hover (and thus the whole drop) resolved to the source. The
  board that is dragging must ignore the echoed `module:hover null` while
  `_dragInstance` is set — otherwise the broadcast wipes the indicator it just
  drew locally (the same-window case passes `instanceId` for a correct index).
  The indicator for a module is only the line/edge (no whole-window outline),
  and the line is clamped inside the column: `.column` clips its overflow, so an
  insert at the very top used to be half hidden. A **whole float** hovering gets
  a different indicator (`_setFloatDropIndicator`): a box around the column it
  would merge into (`kind:'column'`), or the divider line on a seam
  (`kind:'divider'`) — the old source-float `dock-armed` box was removed so the
  box only appears for that column-body case.
- **A float's own ColorStore must be told it is connected.** `ColorStore#_write`
  queues (sets `pendingSend`) unless `connected`; the palette sets it in
  `app.js#updateStatus`, but a float has its own store, and without
  `float.js#onStatus` every pick made in a floated module was queued and never
  sent (CSP Color still worked because it calls `slot` selection directly). It
  flushes `pendingSend` on reconnect, like the palette.
- **A whole float docks by where the pointer is.** `panes.js` arms the dock on
  the float's **overlap** with another window (the palette or another float), not
  on the cursor — the header centre lost the seam, and a cursor test missed a
  flush/snapped float. The drop point is the **cursor clamped into the target**,
  so pointing at a seam or an edge lands there even if the pointer is just
  outside. The float's **live** columns are read via `executeJavaScript` (its own
  save is debounced, so layout.json can miss a just-added column). The target
  merges the modules into the column under the point, or — on a seam
  (`_floatDropTarget` → `kind:'divider'`) — inserts the float's columns there and
  grows by their width (and height when the palette is shorter). The dock timer
  arms once (it is not reset on every move), the float's contents hide while it
  overlaps a window and come back when it does not, and docking is skipped while
  the palette drags a snapped float along (`lastFollowAt`). `_applyWindowSize`
  mutes `_enforceWindowMin` briefly so the explicit grow is not undone by a stale
  `innerWidth`.
- **A float can be collapsed to a bar.** The eye toggles `body.float-collapsed`;
  a multi-module float shows its grip bar, while a **lone module keeps its own
  header** (`.module-body` hidden) so it still reads as that module — the two
  must not look identical. The eye is the rightmost button in the module header
  (and the grip eye is anchored right). `Board#toggleFloatCollapsed` tells main
  with `float:collapsed` so `report()` does **not** persist the collapsed size.
  Windows enforces a ~39 px floor on these frameless windows (verified:
  transparent frameless clamps to 39 even with `resizable:false` and a 1 px
  minimum), so the bar keeps its natural height and `body.float-collapsed #app`
  is transparent rather than stretched; `resizable` is dropped while collapsed
  and restored to `!locked` on expand. Wiring `board.setLocked()` in float.js is
  what keeps that restore correct.

## UI & modules

- **The Settings window's Modules tab is a master/detail list** like Obsidian's
  plugin list: modules sorted by name on the left, each with an on/off light
  (green = enabled) and the selected module's `settingsUI()` on the right.
- **A module may declare `autoHeight: true`** (CSP Color; the slider takes a
  normal column share and adapts instead): with no stored weight it is laid out at
  its content's size (`flex: 0 0 auto`) instead of taking a proportional share, so
  changing its appearance resizes the card. Its `minSize()` must therefore follow
  those settings.
- **The slider is fully responsive.** Its rows share the card evenly (one base
  line each, `flex: 1 1 0`) and the track's thickness is a percentage of that
  share (`--slider-pct`, 100% = the tracks touch), so there is no gap/spacing
  setting and no intrinsic size — the module takes a normal column share. Only
  its `minSize` follows `MIN_ROW`: the mounted instance reports an
  orientation-aware minimum and `ctx.requestLayout()` asks the board to re-read it
  (via `refreshSizes()`, which does **not** rebuild the board) when the slider
  flips between horizontal and vertical. Older settings migrate: a v1 pixel
  thickness becomes a percentage against the pitch it used to sit in, and the
  v2 `gap` key is dropped.
- **The Settings window's module controls show effective settings**
  (`moduleSettingsApi` merges `defaults` + `migrate`), otherwise a module with no
  saved file would show the sliders at their minimums.
- **The Settings window's module preview renders from the module's `defaults`,
  not the current settings.** It is a generic mockup, so it always shows
  everything a module can render (e.g. every Color Slices panel) even when the
  user has switched some off; the controls beside it still show the effective
  current settings (`moduleSettingsApi`). `modules:set` must reach every window's
  copy (palette board, floats, and the Settings controls via `module:changed`).
- **The module-name column shrink-wraps; the settings column never scrolls
  sideways.** `.module-list` is `width: max-content; max-width: 50%;
  flex-shrink: 0` (a shrinkable column squeezes the names to ellipses) and
  `.module-detail` is `overflow-x: hidden`. The window's minimum width is set
  from the longest name plus a usable detail width (`settings:min-width`), so a
  narrow window cannot force a horizontal scrollbar onto the settings column.
- **Clicking the hex copies it** (there is no copy button); the field flashes
  "Copied!" for 700 ms, and typing cancels the flash.
- **A lone float module's header drags the window until the pointer reaches the
  palette**, where it turns back into a module drag (`module:hover` shows the
  palette's drop indicator, and the release uses `module:drop`), so the
  destination can still be chosen.
- **The palette's corner resize grip is invisible** (the visible glyph was
  removed); the drag zone is still there, and `setResizable` is what the lock
  toggles.
- **The CSP Color chips' tooltip leads with the *recorded* hex**, the value the
  footer's hex field shows and the one you would type back into CSP; the chip's
  colour is the appearance, so the tooltip adds `(shown #…)` when they differ.
- **A module's commands are registered with the kernel bus at mount and released
  on teardown** (`ModuleHost._registerCommands` / `reset`), and main owns the
  instance→window map (`src/main/command-router.js`). A rebuilt board that skipped
  the unregister would leave stale handlers, and a rebuilt layout changes which
  window mounts an instance — so a command is addressed by **instance** and routed
  through main, never held as a direct reference. The renderer's registration is
  debounced and replaces the whole per-window set.
- **A user module is unsandboxed** (`docs/USER-MODULES.md`): it runs with the app's
  privileges and holds `ctx.csp`. A bundled module id always wins — a user folder
  may not shadow one — and its assets resolve only under its own `module://<id>/`
  folder, with the same escape guard as `theme://`.

## Rendering

- **The gamut maps are supersampled** (`color-slices.js` renders at ≥2x): at a 1x
  display a 1:1 canvas left a visibly jagged gamut silhouette.


## State & session

- **One canonical model, owned by main.** Windows read from it and send intents; a
  window never hand-mirrors a channel and never mutates the model. A window renders
  through a **pure adapter** (`canonical snapshot → view effects`), registered per
  domain. The legacy per-domain channels still exist behind `--legacy-state` and
  must keep working until they are removed; the canonical model is the default.
- **Authoritative state flows from main; peers carry transient events only.** A
  `MessagePort` (`--peer-bus`) is an optimisation, never the source of truth.
- **Session events are typed** (`src/shared/peer-events.js`): `state`,
  `connected`, `disconnected`, `paired`, `peer-connected`, `peer-disconnected`,
  `sync`, `warning`, `error`. No ad-hoc status strings between windows.
- **The compute host never owns state.** `--compute-host` is a stateless worker
  behind an RPC (`src/shared/compute-protocol.js`); a crash rejects only the
  in-flight request.
- **`layout-service.js` is still the only writer of `layout.json`.** The `layout`
  domain is a read-only view; intents still go through `applyLayoutIntent`.
- **A fallback flag exists for every new mechanism**, and each now defaults to the
  new path — `--legacy-state` (or `--state=legacy`), `--no-peer-bus`,
  `--no-compute-host`, `--no-secret-store` opt back to the old one. Do not flip a
  default in the same commit that introduces the mechanism.
- **Adapters apply state; they never emit intents.** A window never mutates the
  model, so there is no feedback loop.
- **A `state:changed` whose `rev` is ≤ the last applied for that domain is dropped**
  (stale/duplicate), so a delta that raced ahead of the hydrate snapshot survives.
- **Privileged IPC channels validate their sender** (`src/main/ipc-sender.js`):
  colour writes, layout/settings/module changes act only for a live window the handler
  resolves from the event, never a window id taken from the payload.
- **A sibling-palette preview is display-only and exact.** `color:preview` carries
  OKLab, excludes the source window, and never enters the CSP write queue, history or
  `lastColor`. The authoritative `companion:color` still lands on commit; a peer uses
  `ColorStore.applyPreview` without writing or recording.
- **A broadcast failure must never abort a state update.** `state-hub.set` swallows an
  emit error, and every window send goes through `src/main/broadcast.js`, which checks
  both the window **and its webContents** and never throws — a window destroyed between
  the scan and the send must not break the operation that broadcast.
- **Every window addresses its own palette; nothing is "the primary".** The `layout`
  domain carries the v2 document; a board selects
  `doc.palettes.find(p => p.id === its own palette id)` (from `--palette-id=`, exposed as
  `csp.paletteId`), and reads/writes its columns through `palette:columns:get/set`, where
  main resolves the palette from the **sender**. A window can never read or write another
  palette's columns.
- **A colour echo is suppressed only when it matches the value we wrote or the value
  we replaced** — never by time alone; any other value is a real change (an
  eyedropper in CSP) and is accepted. CSP is a lossy 8-bit sink; the renderer's
  OKLab is canonical.
- **A poll result older than a host push is discarded.** `_pollOnce` records the
  host-colour sequence before its read; if a push arrives before the read resolves,
  the read must not overwrite the newer colour. A poll that reverts to the colour we
  just changed away from is CSP read-back lag unless it persists for two consecutive
  polls (within 5 s), which is a real revert. A partial
  `Sync*` is treated as a pick only when it supplies the active slot or changes the
  active slot; an inactive-slot-only update sets `rgbFresh:false` and must not enter
  History. The **pick decision lives in `service._emitIfChanged`** (`selectSlot` and
  `writeColor` emit `color` directly, never `pick`), and **main is the only history
  writer** (`history-recorder.js`): a window mirrors `setHistory` and pushes only its
  own explicit pick. Never bring back a per-window settle — Chromium clamps a hidden
  window's timers to ~1 s, so a hidden palette/float could add an older pick after a
  newer one, and the head-only de-dupe accepted it (the "previous picked colour" bug).
  A left-button release over CSP (`pointer.ps1` → `pointer-history.js`) is the precise
  end of a pick: main takes a fresh read and commits that colour; the 450 ms settle
  remains only for picks with no pointer release (keyboard, hex, paste).
- **The drawing-only gate is one global setting, enforced only in main.** With
  `historyGate` on, a pick (CSP or Iroiroppa) is only *noted*; the next non-Alt
  left-button down on the CSP canvas takes a fresh read and records the colour used.
  No renderer keeps gate state, a window may not add host colours, and a gated
  `history:add` re-broadcasts the authoritative list so a stale optimistic tile cannot
  survive (the old per-window gate leaked exactly this way). Gate off is the normal
  release/settle path, unchanged.
  A left-button release over CSP (`src/main/pointer.ps1` → `pointer-history.js`) is
  the precise end of a pick: main takes a **fresh** `SyncColorCircleUIState` read and
  commits that colour (never the cached one, which can be one poll old). The up may
  replace the tile the fallback settle added during the same gesture. The settle is
  then only for picks with no pointer release (keyboard, hex, paste); if the pointer
  helper dies, every pick falls back to it.

## Windows, focus and snapping

- **Auto-hide follows the foreground; there is no sticky "manual show".** With
  Auto-hide on, `focus-policy.focusAction` shows on Clip Studio Paint, keeps on our
  own windows and during the text-edit grace, and hides otherwise. The old
  `manualShow` flag let one hotkey/tray show keep the palette up over every app until
  CSP was seen again ("it doesn't hide when CSP loses focus"). Auto-hide off is the
  way to pin it.
- **Auto-connect must not scan over a client that is retrying.** A transient
  `reconnect-failed` leaves the state `reconnecting` (not `error`) and `canAutoConnect`
  refuses while `service.retrying()`; a scan there tore down the 250 ms retry and
  turned it into a 30 s scan.
- **The drag overlay never covers a whole display.** It is the union of the displays'
  **work areas**, inset by a pixel (`overlay-bounds.js`). A desktop-sized always-on-top
  surface is what Windows 11's "app in full-screen mode" rule reads as Do Not Disturb.
- **A snap group's shared edge is a splitter.** Resizing a touching edge changes the
  boundary and adjusts the neighbour; resizing an outer edge does not. The pair stays
  flush and clamped to the boards' minima (`layout-geometry#reflowSnapResize`). Group
  membership is derived from the document's `snap`/`snapTo`, never a parallel map.
- **Every window fits its own content.** A float with only natural modules shrinks to
  its cards; it resizes itself (`resizeSelf`) and never the palette. A programmatic
  fit pins the snapped edge rather than opening a gap.
- **The Modules tab light is an indicator.** Module-wide disable wrote the legacy v1
  board, which a model-mode palette ignores; hide/show is per instance and goes through
  `module.hide`/`module.show` intents so every window follows. `+ Add` is the enable.
- **The palette name takes the space it needs** until it meets the action icons;
  `field-sizing: content` is what keeps it from ellipsising at the old 11ch box.
- **The profile picker and the palette menu are overlay menus.** An in-window popup is
  clipped by the palette's `overflow`; both go through `kernel/overlay-menu.js`, which
  owns the one outside-click close so they cannot fight.
- **Showing the palette resets transient input owners.** Tray/hotkey show closes the
  overlay menu and module-settings popout, re-enables each palette/float, and sends
  `input:reset`; the renderer releases tracked pointer captures and clears drag/lock
  state without touching the colour. A palette click also closes the module-settings
  popout, because the non-activating palette does not blur it. A dead renderer is
  reloaded once (twice at most) rather than leaving a painted, inert window.
- **A removed module's hidden instance is dropped too.** A module the manifest no
  longer knows cannot be shown again, so `normalise` drops both placed and hidden
  entries when a registry is given.
- **CSP shortcuts come only from the active workspace.** `csp-shortcuts.js` resolves
  the current `.spws` each call and does not merge `default.khc` into a populated
  workspace; the source line reports its save time, and Refresh re-reads it. CSP
  may not flush edits until the workspace is saved or CSP closes.
- **Auto-hide is instant and watcher-owned; blur is not a hide trigger.** The
  foreground watcher uses a Win32 `EVENT_SYSTEM_FOREGROUND` hook (with a poll fallback
  only if the hook cannot be installed). A `hide` event calls `hidePopup()`
  immediately: no debounce, no PowerShell re-query. If the watcher is down, keep the
  palette. The Settings Auto-hide switch calls `applyAutoHide` at once. The watcher
  keeps running when Auto-hide is off, because the Companion worktime gate needs the
  foreground process; `focusState` then returns `keep`, so visibility is unchanged.
- **The overlay profile menu is ten rows and never shrinks its rows.** `menuBox` caps
  at `maxRows = 10`, sizes the overlay window before showing it, and the menu list
  scrolls. `.overlay-menu-item` must keep `flex: 0 0 auto` and a line-height that does
  not clip; the old flex-shrink squashed every row into half a line.
- **The Modules light is a live indicator of *visible* instances.** `module-usage.js`
  counts columns and floats; hidden instances are counted separately. A light turns
  green for `visible > 0`, grey when every instance is hidden or none exists, and its
  title says both counts. It is never a module-wide switch.
- **A slice's rotate/flip is display-only and invertible.** `slice-view.js` provides
  `forward` and `inverse`; `color-slices` paints through the forward transform and
  every `attach` picker maps pointer coordinates through the inverse before applying
  the axis mapping. The colour maths and the plot cache never see the transform.
- **A slice's plane ordering is by axis role, not by model index.**
  `color-models.js#planesFor` derives the three planes from each axis's `role`
  (`hue`/`chroma`/`lightness`): the fixed-hue plane is always first, then
  fixed-lightness, then fixed-chroma. Names are the two free channel labels in display
  order (`L × C`, `H × C`, `H × L`; OKHSV's first is `V × S`).
- **A slice drag pins its plane.** The pointerdown snapshots the fixed axes and every
  move uses them; a gamut snap may move the colour along the boundary but never feeds
  a new fixed axis back into the plane. That feedback loop was the HelmGen LCH hue
  drift while dragging LC.
- **Shown == pickable.** The raster and the pointer share
  `slice-geometry.js#inside` (the model's `inGamut` if it has one, else
  `store.inGamut`); `dense` never skips the test. A value the slice cannot show is
  clamped at the edge (a dashed crosshair ring), never silently dropped.
- **The lightness guide is model-native, one source and one line.**
  `slice-geometry.js#lightnessOf` uses the model's own light axis when
  `lightSource: 'native'` (OKLCH/OKLab, CIELCH, HelmGen, future CIELAB/HCT/CAM16),
  and canonical OKLab L for the sRGB-relative OKHSV/OKHSL views. There is no
  global source setting. The guide is exactly one iso-L contour (`guideCurve`); it is
  absent only when the fixed axis already carries the native light axis. Shift holds
  that value for the gesture (before or during the drag): a free light axis is solved;
  in a fixed-light plane the vertical free axis is solved, which projects the press onto
  the contour **without moving the plane**. A sample whose target cannot be reached is
  dropped, never drawn as a line along the panel edge. The guide is a thin overlay
  hairline, not a raster pixel; it is red while locked. Slices/Wheel/Disc each have a
  show/hide toggle; the Slider has no guide. The crosshair is separate: full-width/height
  hairlines under the small ring
  pointer.
- **Slice rasters follow a drag live without freezing it.** During any drag, the
  visible panels are rebuilt round-robin (one panel per frame) at the **full backing
  resolution**, with the crosshair/guide overlay redrawn on every panel every frame;
  sibling panels reuse their full-resolution cached raster. No downscaled or
  block-filled map is ever shown. The active panel's fixed axes stay pinned; a
  dragged slice's other panels use the live axes. Freezing the other panels until
  release was the "slices don't update" bug; dropping the backing canvas to 1× was
  the jagged-edge regression. The same "one panel per frame" rule covers a
  Wheel/Disc/Slider drag, so those modules do not make the Slices rasterise three
  full maps per pointer move. Palette and float windows disable Chromium background
  throttling so a sibling palette keeps its frame loop while another window is
  dragged.
- **The wheel's hue ring is a fixed-lightness gamut edge, not OKHSV max-sat.**
  OKHSV S=1/V=1 follows the sRGB blue fin and jumps at the primary (a visible blue
  seam). Both bands sample a constant-OKLab-L max-chroma edge; the outer is fixed at
  L=0.70, the inner uses the selected L. The hue pointer sits on the outer band and is
  the Color Slider ring; the inner shape has the separate small pointer. Inner
  rotate/flip is display-only, and the canvas transform must apply flip before rotate
  to match `SV.forward()`.
- **The disc rim is fixed across lightness.** For absolute-chroma views it is the
  global in-gamut extent over reference lightnesses, not recomputed at the selected L;
  the silhouette changes inside a stable radius, so the hue/chroma pointer does not
  slide when the L row moves. The disc is always full 2×; while the L row is held, the
  last full raster is reused and only the overlay moves.
- **The last module's bottom edge outranks the palette's.** `_makeEdge` places its hit
  area inside the card (the OS owns the window's outermost pixels), and `_dragRatio`
  writes the same height:width ratio as the Module Size slider. A ratio drag also
  fits the parent window (`_fitNaturalWindow`), growing or shrinking it to the cards
  while `_moduleEdgeDrag` suppresses the window-edge aspect-ratio heuristic.
- **A module edge drag writes a ratio height** (the same value as the Module Size
  slider), capped at 2.5 and floored at the module's minimum. The shared edge resizes
  the ratio module above it, or the one below when the above is a fill.
- **A projection is display-only and invertible too** (`src/shared/projection.js`).
  `flat` is the unrolled rectangle, `polar` puts hue on the angle and chroma on the
  radius (mask = outside the disc), `triangle` is the **cusp frame** (black, white and
  the hue's cusp are the corners; the whole lightness×chroma square is mapped onto it,
  so no colour is lost and the cusp is always the apex) and `triangleFixed` is the
  Okhsv frame. The cusp frame keeps the square mode's black-white side (the inscribed
  square's left corners) and its cusp slides on the vertical line x = 0.9. The Okhsv
  fixed frame is the **equilateral triangle inscribed in the inner circle** (all three
  corners on it; its base is that triangle's own black-white side, not the square's).
  The raster inverts the map per pixel and the picker maps the press forward; a point
  the triangle cannot express is clamped, never dropped. Only a panel whose axes can
  carry the shape offers it (`supports`).
- **The gamut silhouette stays the union of `chromaIntervals` in every projection.**
  A binary search from zero (or a first-crossing scan) under-fills at blue's fin, and
  smoothing the boundary to hide it is the bug, not the fix.
- **CSP shortcut comparison normalizes both sides.** `CommandOrControl`/`Control`
  become `Ctrl`, modifiers are ordered, key aliases (`Return`/`Enter`, `DELETE`/
  `Delete`) meet, and numpad `NUM+` is not the same key as `Plus`. A clash warning is
  advisory; CSP's files stay read-only.
- **ICC Browse is an action, not a profile.** The overlay action row (folder icon,
  separator) and the Settings `profile-browse-btn` are deliberately not radio rows;
  both call `browseProofProfile`, then apply and refresh the list.
- **The app and tray icons are the same pastel big-I art** (`icon-art.js`): a rounded
  square with a centred I, no hue wheel. The tray converts RGBA to BGRA.
- **CSP menucommand ids are never shown raw.** `csp-command-names.js` resolves a live
  toolbar label, then a curated name, then a tokenized human name; the raw id stays in
  the tooltip. Tool/brush names come from CSP's Node databases, not only the tool DB.

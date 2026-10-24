# AGENTS.md — working notes for Iroiroppa

Context for anyone (human or AI) picking this project up. Read it before
changing code. It records the decisions and the hard-won gotchas; the *why* is
often more important than the *what*.

## What this is

Iroiroppa is a Windows OKLCH colour picker popup for Clip Studio Paint (CSP).
It connects by **impersonating the phone side of CSP's Companion Mode**
("Connect to smartphone"). It is unofficial and not affiliated with CELSYS.

Two colour concepts are easy to confuse and both matter:

- the **displayed space** — OKLCH; this is what the picker's axes describe;
- the **recorded values** — the raw channel values CSP stores; this is exactly
  what the Companion protocol reports, and it carries no colour space (the same
  numbers come back from any document). Their meaning is set by the document's
  **embedded profile**, which never crosses the wire, so Iroiroppa is told it
  with the profile picker. For an Adobe RGB document those values denote Adobe
  RGB, not sRGB; the canvas merely renders them to the display.

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | run the app |
| `npm run dev` | run with devtools; window stays open when focus is lost |
| `npm test` | `node:test` suite — no Electron required (2 seconds) |
| `npm run map [filter]` | print a code index (file + line + declaration) instead of reading whole files; `--files` lists every file the walk saw |
| `npm run screenshot` | regenerate `docs/screenshot.png` from the standard recipe |
| `npm run bench` | headless micro-benchmarks (see `docs/PERF.md`) |
| `npm run theme:check` | validate a theme file (or all bundled) against the token manifest; `theme:docs` regenerates the token table, `theme:preview -- <id>` renders one |
| `npm run probe` | standalone CLI client: scan the QR, read/write the colour |
| `npm run i18n` | check the locale catalogs against the keys the code asks for |
| `npm run icc` | regenerate the synthetic ICC used by the proof tests |
| `npm run icon` | regenerate `build/icon.png` |
| `npm run pack` / `npm run pack:run` / `npm run dist` | electron-builder (fetched on demand); **`pack:run` also (re)launches the packaged app — the standing rule after any code change** |

Requires Node 18+ (developed on Node 24) and Windows 10+.

## Development flags

The full table of --shot/dev flags lives in docs/DEV.md — they are how the UI is
verified without a human clicking.

## Architecture

The source layout and process split live in docs/ARCHITECTURE.md.

The multi-window state model — one canonical model, pure per-window adapters and a
typed session/peer layer — lives in docs/STATE.md.

## Protocol essentials

Framing, keys, the idle gate and the polling rules live in docs/PROTOCOL.md.

## Invariants — do not regress these

- **OKLab is the canonical colour value; OKLCH is a derived view.** `ColorStore`
  holds `L`/`a`/`b` plus a **hue anchor** (a rectangular space has no hue at
  `C = 0`); `lch()` derives `C` and returns the anchor. Render the appearance from
  the stored Lab, never by re-deriving LCH — the swap must stay invisible
  (`test/oklab-canonical.test.js`, `docs/COLOR.md`).
- **Gamut tolerance must be magnitude-relative** (`1e-5 × max|channel|`), not an
  absolute epsilon — an absolute epsilon near black accepts a spurious chroma and
  spikes the dark end of the lightness map. Applies to both `color.js#inGamut`
  and `proof.js#inGamut` (linear profile space in the latter). The interval maths
  is written three times (`color.js`, `createLutProof`/`createProof` in `proof.js`),
  so a tolerance or snap fix must reach all three.
- **The gamut boundary is a union of chroma intervals, not a single range**, near
  the primary corners (at blue's hue: the body plus a thin fin to the primary).
  `maxChroma` returns the outermost interval end and snapping uses `reduceChroma`
  (never raises chroma); a binary search from zero under-fills and draws blue as
  unreachable. `chromaIntervals` enumerates the bands from the channel cubics.
- **`Color.rgbToHex` takes 0–255; `Color.rgb01ToHex` takes 0–1.** No per-channel
  "is this a float?" heuristic — a channel of exactly `0` or `1` is misread and
  out-of-sRGB appearances render the wrong colour.
- **The gamut-plot cache key includes profile identity and gamut**, and the
  chroma axis covers the active gamut (`proof.chromaAxis()`) — otherwise
  switching profiles leaves stale maps and saturated greens are cropped off the
  top.
- **Chroma may sit outside the gamut, up to the axis bound, on purpose** (the C
  slider is pushed past the boundary so the Hue slice is seen to transform).
  Slice drags snap as before, and **every recorded value (CSP, hex, paste, proof
  re-interpretation) is always snapped**.
- **Colours the sRGB window cannot show are drawn at the same lightness, not
  clipped.** `Color.fitToSrgb` keeps L and H and pulls C to the sRGB edge; a
  channel clamp instead puts a lightness step exactly where the sRGB boundary
  crosses a slice (the "suspicious arc"). The pick and the recorded value keep
  the true chroma — never fit them.
- **Partial `Sync*` payloads are merged** into the last known state — never let
  them blank `main`/`sub` or fabricate a change.
- **The heartbeat's idle-timer reset is conditional** (`_mayKeepHostAwake`): it
  is sent only while the palette is visible, **CSP is the foreground app**, and the
  machine has recent input. An empty heartbeat still keeps the connection alive.
  Resetting it unconditionally (or while the user is in another app) keeps CSP's
  per-document worktime tracker counting forever.
- **Writes are sticky for a grace window**, so a lagging read-back cannot revert
  the UI to the previous colour.
- **A connection attempt only owns the client while it is current**
  (`pairWithPayload`/`connectSaved` guard on `this.client === client`). A late
  failure from a superseded attempt must not clear it or set status, or the app
  "instantly disconnects" seconds after a successful manual connect.
- **A saved pairing that cannot re-authenticate must give up and go idle** after a
  few failed reconnects, so auto-connect can scan for the new QR; retrying
  forever leaves the app stuck in `reconnecting` and starves the scan.
- **Auto-connect must not scan over a client that is retrying.** A transient
  `reconnect-failed` is `reconnecting`, not `error`, and `canAutoConnect` refuses while
  `service.retrying()` — a scan there tears down the 250 ms retry and turns it into a
  30 s parked scan.
- **Auto-hide follows the foreground; there is no sticky manual pin.** Shown by the
  hotkey/tray or not, the palette hides when the foreground is neither CSP nor one of
  our windows (`focus-policy.js`). A sticky `manualShow` was the "it doesn't hide when
  CSP loses focus" bug; Auto-hide off is how you keep it up. **The watcher is the only
  owner of visibility**: blur never hides; `foreground.ps1` is event-driven
  (`EVENT_SYSTEM_FOREGROUND`) and the palette hides immediately when the event says
  so, with no debounce or re-query. If the watcher is down, keep the palette. The
  watcher keeps running when Auto-hide is off (it also feeds the Companion worktime
  gate); `focusState` then returns `keep`, so nothing is hidden or auto-shown.
- **The overlay profile menu is capped at ten rows and scrolls** (`overlay-menu-box.js`).
  It is a separate non-activating window whose bounds are computed before it opens;
  a row must never flex-shrink (the "text cut in half" bug).
- **Slice rotate/flip is display-only.** `slice-view.js` transforms the drawn plot and
  picking applies its exact inverse; the colour maths, cache and recorded values stay
  canonical. A transform that only moves the bitmap but not the picker is a bug.
  **Projections** (`projection.js`: flat / polar / triangle) follow the same rule —
  the raster inverts the map per pixel and the picker maps the press forward — and
  the triangle's apex *moves with the hue* on purpose: it is the cusp frame.
- **A non-activating window must be *in* the topmost band, or it can never come forward.**
  The palette and floats are `focusable: false`, so a click does not activate them; if
  the always-on-top request is dropped the window sits at the bottom for good. Electron
  on Windows 11 build 26300 (Oct 2026 updates) drops it — `setAlwaysOnTop(true)` leaves
  `isAlwaysOnTop()` false — so `src/main/topmost.js` falls back to a one-shot
  `SetWindowPos(HWND_TOPMOST)` (`topmost.ps1`, asar-unpacked) after every show, and is a
  no-op wherever the runtime did its job.
- **A snap group's shared edge is a splitter, and group membership is derived.** A
  resize of a touching edge resizes/moves the neighbour so the pair stays flush; the
  graph comes from the document's `snap`/`snapTo`, never a parallel map. The drag
  overlay covers the displays' **work areas**, never a whole display, or Windows 11
  turns Do Not Disturb on.
- **Main owns the shared state; every window mirrors it.** `writeColor` is
  broadcast after flushing, and the colour history is `history:get` plus a
  head-deduplicated `history:changed` that each `ColorStore` mirrors via
  `setHistory()`. **Main is the only history writer**: the service's `pick` event
  goes through `src/main/history-recorder.js` (one fallback settle), and a left-button
  release over CSP (`pointer-watch.js` + a fresh protocol read) commits the exact final
  colour at once. With the global `historyGate` setting on, a pick is only noted and
  a non-Alt canvas down commits instead; no window keeps gate state. A window sends
  only its own explicit pick (`history:add`). Never
  record host colours in a renderer: its 450 ms settle is throttled to ~1 s while the
  window is hidden, so an older pick could land after a newer one. A new window must
  mirror, not write.
- **The canonical state model is rev-guarded and one-way.** A `state:changed` whose
  `rev` is ≤ the last applied for that domain is dropped (so a delta racing the
  hydrate snapshot survives); adapters apply state and never emit intents; and a
  privileged IPC channel acts only for a live window it resolves, never a window id
  taken from the payload. `docs/STATE.md`.
- **A colour echo is suppressed only when it matches what we wrote or what it
  replaced** — never by time alone. Any other value is a real change (an eyedropper
  in CSP) and is accepted. A poll that was in flight when a host push arrived is
  stale and discarded; a poll that reverts to the colour just changed away from is
  read-back lag and is ignored briefly; a partial sync only counts as a pick when it
  supplies or changes the active slot. `src/main/service.js`, `docs/STATE.md`.
  **A window also ignores an incoming RGB it wrote itself** (`ColorStore._ownWrites`):
  the service broadcasts every write back to every window, and re-deriving the pick
  from that 8-bit record rotates the hue by up to a few degrees, or adopts a record
  that clipped at the gamut. Main's burst filter cannot help there — the value is
  ours by construction, not a lagging host read.
- **Never send to a destroyed `webContents`.** Every window send goes through
  `src/main/broadcast.js` (`sendTo`/`broadcast`), which checks the window *and* its
  webContents and never throws; `state-hub.set` swallows an emit error. A throw there
  used to abort the state update that broadcast — the root cause of a class of
  post-rewrite bugs (a dead window during a drag killed the layout push).
- **`layout.json` has one writer: `src/main/layout-service.js`.** Nothing else may
  read-modify-write the file — that is exactly how two writers used to silently
  lose each other's layout change. Reads and writes go through the service (the old
  store, `board-store.js`, is gone); the v1 view in `layout-view.js` is
  transitional and shrinks as each interaction becomes an intent.
- **The window is non-activating** (`focusable: false`) so clicking the palette
  never steals focus from CSP. Text fields temporarily enable focus; both hide
  paths ignore the resulting blur/foreground change for ~900 ms.
- **The UI scale zooms the web contents; both windows grow with it.** Keep a
  CSS-pixel layout size × the scale (so the remembered size does not compound),
  re-apply `setZoomFactor` on `did-finish-load` (Electron drops an early one),
  and re-fit the Settings window on viewport `resize`.
- **The window remembers its monitor.** `windowBounds` carries the display id and
  `src/main/window-bounds.js` clamps it into a live work area (falling back off
  an unplugged monitor) — never `setPosition` a saved record directly.
- **Changing the profile or model must re-interpret the stored colour** — never
  re-send it, since the stored value has not changed. The plot cache needs no
  clearing: its key carries the profile identity and gamut.
- **Every palette is addressed by id, and main owns `layout.json`.** No board ever
  writes the floats: a board reads and writes **only its own** palette through
  `palette:columns:get/set` (the palette is resolved from the *sender*, never from
  the payload), and the `float:columns:*` channels are gone. A cross-window drop is
  resolved in main so a board can never hold a module twice. A float that empties
  closes and is pruned.
- **A float never resizes the palette.** `Board` takes its `resize` callback
  (`csp.resize` for the palette, `resizeSelf` for a float); `_enforceWindowMin`
  must use it too. The lock freezes window sizes as well (`setResizable` on the
  palette and every float).
- **Nothing may leave empty space in a column.** A module alone in a column (an
  edge drop, a float's sole module) always fills it; only when something else in
  the column is fluid does an `autoHeight` module keep its own size.
  `_applyModuleWeight(el, mod, { alone, stretchLast })` encodes this.
- **A theme's CSS is injected after the base styles and the token block, and the
  tokens go in a `<style>` block — never inline on `<html>`.** Inline styles outrank
  a theme's stylesheet, so moving the tokens back inline silently breaks every theme
  that overrides one. A theme's assets resolve only through `theme://<id>/<path>`
  inside the theme's own folder; a path that escapes it is refused.
- **Theme tokens are split paint vs structural.** `paint` (colour, `--shadow`,
  `--radius`) never changes geometry; `structural` (`--font-ui`, `--mono`,
  `--font-size`, `--space`) can change a card's measured size, so changing one
  fires `theme-structural` and the window re-clamps once (`app.js`/`float.js` →
  `board.remeasure()`). A theme's CSS may only paint — `theme-check` fails a
  bundled theme that sets a layout or per-frame property. `docs/THEMES.md`.

Detailed regression notes for the rules *not* in this core list: `docs/INVARIANTS.md`.

## State on disk

`%APPDATA%\Iroiroppa` holds `settings.json`, `session.json` (**never commit**),
`layout.json`, `modules/<id>.json`, `workspaces/<id>.json` (named saved workspaces)
and an optional `themes/` folder. The shapes, and who owns what, are in
`docs/ARCHITECTURE.md`.

**A portable build keeps the same tree in `Iroiroppa Data` beside its exe**
(electron-builder exports `PORTABLE_EXECUTABLE_DIR`; `src/main/portable.js`
points `userData` there, falling back to `%APPDATA%` if the folder is
read-only). The lock follows that folder, so a portable copy and the installed
app can run side by side.

## How to verify a change

1. `npm test` (82 test files, 592 tests; protocol, colour, proof, layout, state, release-notes and i18n layers).
2. A `--shot` at 260 px and at 200 px; check the dumped JSON and the image.
3. When it touches the connection or writes: a live check against CSP. Remember
   only one controller can connect, so quit the app first if you use the probe.
4. `npm run pack:run` after any code change — and check the app is actually
   running, not just that the command exited 0 (see the note below).

**If a shell exports `ELECTRON_RUN_AS_NODE`** (an agent harness or an IDE does),
every Electron launch runs as plain Node instead: `require('electron')` is
`undefined`, `--shot` dies in `main.js` on the privileged-scheme call, and the
packaged exe starts, does nothing and exits 0 — so `pack:run` reports success
while nothing runs. The three scripts that launch Electron
(`screenshot.js`, `theme-preview.js`, `launch-packed.js`) delete the variable for
the child. Check `Get-ChildItem Env:` before believing an Electron failure is a
code failure. A `--shot` run also skips the single-instance lock: without that,
a shot taken while the app is open captures *the user's own window*.

## Screenshots

`npm run screenshot` regenerates `docs/screenshot.png` and is the source of truth
for the recipe (300 px wide, 900 px tall; the slot colours, slider thickness and
the history rows; a throwaway profile that talks to `scripts/fake-host.js`, not
CSP). The palette fits its own content, so the height comes from the ratios in
the recipe's `layout.json` and from the modules present — **re-measure instead of
assuming**, and keep the recipe comment's breakdown honest. **Adobe RGB
(1998) is the only profile that may ever appear** in a screenshot, a demo, a
release note or any artifact — never another ICC profile, and never a real
user's settings or history; the script aborts if that profile is missing.

## Token discipline

Cost is dominated by **new** (uncached) text: every fresh file read, command
output and reply. Cached repeats (this file, the docs, the conversation) are
~50× cheaper, so the goal is fewer, smaller *new* tokens — not shorter docs.

- **Read narrow.** Search for the symbol first (`grep`/`Select-String`) — or run
  `npm run map <filter>` for a file/line index — then read only the matching
  range. `src/main/main.js` is ~23k tokens whole and `kernel/layout.js` ~13k;
  reading either in full is the most expensive thing a session can do.
- **Keep command output small:** filter it (`Select-String`, `-First`, `--silent`),
  and prefer the 2-second `npm test` over launching the app.
- **Skip the `--shot` renderer dump** when only the picture matters; it is for
  verifying layout/numbers.
- **Brevity by default, plain language, never on verification.** Lead with the
  answer in one short sentence; no preamble, no restating the question. Bullets
  over prose, about five, unless more is asked for. Gloss any jargon on first use
  (three words) — the reader is not a programmer. Depth is on request ("ask for
  the deep version"), never volunteered. Verification is the exception: always
  show the real result and the numbers (pass/fail, counts, sizes) — a hidden
  failure costs far more than the words it saves.
- **Explore in a subagent** (`explore`): its reading never enters the main context,
  and it can run a cheaper model.
- **Plan before code** for anything structural — a 200-token plan is cheaper than
  a wasted session, and the plan is where a misread gets caught.
- **One session per task.** Start a new session for unrelated work and let this
  file be the handoff; staying in a stale, enormous session costs attention
  (and a cold cache re-reads it all).
- Fix the docs whenever they are wrong (a cache re-read costs cents), but keep
  them **short** — this file is re-sent with every message.

## Conventions

- CommonJS, 2-space indentation, no build step for the renderer.
- New dependencies need a reason; the runtime carries `jsqr` (QR decode) and
  `jscolorengine` (the CMYK proof engine, main process only).
- Tests live next to the layers they cover; prefer a synthetic fixture (see
  `src/shared/synthetic-icc.js`) over depending on a machine-specific file.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).

## Branches

`main` is the released line; `dev` is day-to-day work; short-lived branches off
`dev` are squash-merged to keep history linear. The full strategy is in
`docs/RELEASE.md`.

**Do not confuse the branch with the document.** `layout.json` carries a
`version` of its own: 1 the original board, 2 palettes with snapping (what
`dev` runs), 3 the modules-only flat list (not currently on a branch). Write
"schema 1/2/3" when you mean the file, or the next reader will think you renamed
a branch.

## Releasing

The procedure is the `release` skill; the checklist, semver rules, asset names
and release-note rules live in `docs/RELEASE.md`. Each release also has a
checked-in `release-notes/vX.Y.Z.md` file; `npm test` enforces its structure and
the release workflow publishes it. Always true, and never to be broken:

- **The version moves only at release** — one bump, in the release commit, in
  `package.json` *and* `package-lock.json`. During development the app reports the
  last released number; changes accumulate under `[Unreleased]` in `CHANGELOG.md`.
- **A `v*` tag is the whole release**: it triggers CI to build and publish. Never
  build or upload by hand, and never move a published tag.
- **Tagging and any major bump need the maintainer's explicit go-ahead.**

## Keeping the docs in step

A change is not finished until the doc that describes it is updated — an
out-of-date doc is read as fact by the next agent or contributor:

| When you… | Update |
| --- | --- |
| add, rename or change a dev flag | the flags table in `docs/DEV.md` (`src/main/main.js` is the source of truth) |
| change behaviour, or fix a bug that could come back | the **Invariants** core list here if a refactor could silently break it, else `docs/INVARIANTS.md` — always with the *why* |
| change the layout, board, dragging or window model | `docs/LAYOUT.md` (the spec, its invariants and the phases), then `docs/INVARIANTS.md` for the v1 rules left behind |
| add/remove a selector module, or change the board's design | `src/shared/module-manifest.js` (the module list), `docs/MODULES.md`, the Settings → Modules tab names, and the source layout in `docs/ARCHITECTURE.md` — `npm test` fails until the manifest, the files on disk and both docs agree |
| change the protocol layer | `docs/PROTOCOL.md` |
| change colour or proofing maths | `docs/COLOR.md` |
| add or change a theme, or a theming token | `docs/THEMES.md` (the token table is generated), then `docs/ARCHITECTURE.md` / `docs/MODULES.md` — `npm test` fails until the manifest, the bundled themes, the renderer CSS and the doc agree |
| change the icon, tray, packaging or CI | `docs/ARCHITECTURE.md` and the **Commands** table here |
| change the release process, tagging or versioning | `docs/RELEASE.md` |
| add or change the state model, a domain, the session layer or a fallback flag | `docs/STATE.md` (the spec) and `docs/INVARIANTS.md` |
| add or change an agent workflow | its `SKILL.md` under `.agents/skills/` |
| move an item off the backlog, or decide not to do it | the maintainer's private roadmap notes (outside this repository) |
| ship anything user-visible | `[Unreleased]` in `CHANGELOG.md` as you work (renamed to a dated section at release) **and** the README |
| touch the UI | `npm run screenshot`, then commit `docs/screenshot.png` |

**Before every non-beta release**, re-read the README top to bottom against the
app — feature list, install steps and asset names, credits, AI disclosure — as
`docs/RELEASE.md` spells out. It is the one document users actually read.

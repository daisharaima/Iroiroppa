# Layout & windows

How the picker's windows and boards are built, and where this architecture is
going. **Read this before touching the board, dragging or `layout.json`.**

`src/main/panes.js`, `src/renderer/kernel/layout.js` and the float half of
`src/main/windows.js` implement the *current* design; this file describes the
target, which is landing in phases. Each phase must leave `npm test` and the
`--shot` workflow green.

## Why this rewrite

The current system grew one interaction at a time, and its faults are structural
rather than local:

1. **Three owners of one truth** — the palette's `Board.layout`, each float's
   `Board.layout`, and main's `floatWins`/`floatSnap`/`collapsedFloats` plus
   `layout.json`. Nothing is authoritative, so they are reconciled by convention.
2. **Two unsynchronised writers to one file** — the renderer's debounced
   `_save()` and main's `report()`/`layout:set` each read-modify-write the whole
   document, so a save can silently clobber another (`lost update`).
3. **Every mutation exists twice** (`_dropExternal`/`dockModuleOut` in the
   renderer, `addFloat`/`dockFloatModule` in main) with no transaction — a
   dropped `module:accept` loses a module, because the source already deleted it.
4. **The drag is a distributed state machine with no owner**, held together by
   wall-clock timers (`lastFollowAt`, the dock-arm timer, `settleChecks`,
   `_resizeGraceUntil`, the edge-hint timer) and an `executeJavaScript` read-back
   into another renderer.
5. **Stringly-typed, unvalidated messages**, no schema, no revision, and
   `layout:changed` reaches the palette only — never a float.
6. **Three coordinate units** (screen DIP, window DIP, CSS px) with zoom
   re-applied at every hop.
7. **A separate code path per source/destination pairing** (palette→float,
   lone-float→palette, …), which is why the same bug keeps returning in a new
   combination.

## Principles

1. **One document, one writer.** Main owns the workspace and is the only writer.
   Renderers never persist layout.
2. **Everything is a palette.** No main window / sub window split. A float is
   just another palette; "Palette 1" is only the first one.
3. **Intents in, snapshots out.** Renderers dispatch intents; main validates,
   reduces and broadcasts a revision-stamped document to every palette.
4. **One resolver.** The same resolution produces the drop indicator and commits
   the drop, so the picture can never disagree with the outcome.
5. **One unit boundary.** DIP at the OS edge, CSS px inside a palette, converted
   once in main.
6. **Geometry is a constraint, not a command.** A board declares its minimum size
   and its content size; main is the only caller of `setBounds`, `setContentSize`
   and `setResizable`.
7. **Pure core, headless tests.** The reducer, the geometry and the resolver have
   no Electron and no DOM.
8. **Nothing may leave empty space in a column** (kept from the old design).

## The document — schema v2

`%APPDATA%\Iroiroppa\layout.json`:

```json
{
  "version": 2,
  "palettes": [
    {
      "id": "p_3fa1",
      "name": "Palette 1",
      "pos":  { "x": 120, "y": 80, "displayId": "\\\\.\\DISPLAY1" },
      "size": { "width": 300, "height": 640 },
      "collapsed": false,
      "snap": null,
      "snapTo": null,
      "columns": [
        { "id": "c_9c01", "width": null,
          "modules": [
            { "instanceId": "i_77b1", "moduleId": "csp-color",
              "height": { "mode": "auto" }, "collapsed": false },
            { "instanceId": "i_2e90", "moduleId": "color-slices",
              "height": { "mode": "fill", "weight": 1 }, "collapsed": false }
          ] }
      ]
    }
  ],
  "nextPaletteNumber": 3
}
```

- `snap` is one of `null`, `"left"`, `"right"`, `"top"`, `"bottom"`; `snapTo` is
  the palette it is attached to, and a snapped palette **follows** its anchor's
  moves.
- `collapsed` is persisted (the old design kept it in a main-process `Set`, so it
  was lost on restart). A module's `collapsed` keeps only its header; the field is
  additive so older documents read as expanded.
- A column's `width` is CSS px, or `null` to share what is left.
- Main generates every `paletteId` / `columnId` / `instanceId`; a renderer never
  invents one (the old design repaired duplicate ids after the fact).

### Units

| Thing | Unit | Converted where |
| --- | --- | --- |
| Cursor, display work areas, drag hit points | DIP | never |
| `pos.x`, `pos.y` | DIP | never (Electron native) |
| `size.width`, `size.height` | CSS px | `panes.js`: `content = size × zoom` |
| Column `width`, module `height`, gaps | CSS px | never |

Exactly two conversions exist, both in `src/main/panes.js`.

### Height modes

A palette holds **one column** now (a legacy multi-column document collapses to one when the board loads
it): every module is stacked top to bottom in that single column.

- `auto` — the module's measured content height (Color Stat, Session).
- `px` — an explicit height. Legacy: the current splitter and edge drag write
  `ratio`, never `px`.
- `fill` — absorbs the leftover space, shared by `weight` among `fill` siblings.
- `ratio` — **locked-ratio sizing**: the module's height is its column's content
  width times a ratio (height : width). It is the default for a module that
  declares `defaultRatio` in the manifest (CSP Color, Color Slices, Slider,
  Color History); the **Module Size** slider in Settings → Modules edits it per
  instance (`module.setHeight`), and so does dragging the card's **bottom edge**
  (`ratioFromDrag` in `layout-model.js`, capped at 2.5). A shared edge resizes the
  ratio module above it (or the one below when the above is a fill); the last
  module in the column gets its own edge handle, placed inside the card so it wins
  over the OS window-resize border. A ratio drag also requests a parent-window fit
  (`_fitNaturalWindow`) after each move: an all-natural palette grows or shrinks so
  the module's new height is visible instead of being clipped/left with a gap. Auto-height modules have no edge handle, and a
  palette whose modules all fit their own size is exactly as tall as its content —
  the window grows to, and shrinks onto, its **tallest column**.

A module's **orientation** (horizontal | vertical) is a per-instance setting for
Color Slices, Slider and CSP Color; nothing flips on the box's shape.

The aloneness and stretch-last rules are **layout**, not a stored rewrite: a
column with no `fill` module gives the leftover to its last module, so a lone
module always fills its column. A **lone column** likewise always fills the board
width — with nothing to trade against, a stored width could only leave a gap.
See `docs/INVARIANTS.md`.

### Normalisation

Runs after every intent (`layout-model.js#normalise`): prune empty columns,
repair duplicate ids, drop unknown modules when a registry is given, default a
missing size or name. It never moves modules and never closes a palette — those
are intent semantics.

A palette emptied **by a drop** closes, unless it is the only palette, which
stays open as an empty drop zone so the user is never left with no window.

## Intents

Renderers call `layout.dispatch(intent)`. Main applies them in arrival order and
answers `ok` or `rejected` (with a reason), so a source can always restore what it
changed optimistically.

| Intent | Payload |
| --- | --- |
| `layout.place` | `{ items, grouping: "flat" \| "columns", sourcePaletteId, target, width? }` |
| ↳ `target: column` | `{ kind, paletteId, columnId, index }` |
| ↳ `target: seam` | `{ kind, paletteId, seamIndex }` |
| ↳ `target: outer` | `{ kind, paletteId, side: "left" \| "right" }` |
| ↳ `target: desktop` | `{ kind, pos, size }` — a new palette |

The **drop resolver** (`drop-resolve.js`) no longer produces `seam` or `outer` targets: a drop
anywhere in a palette lands in that palette's single column at the y-index under the pointer, with the
horizontal insertion line. The reducer still accepts `seam`/`outer` (the drop-matrix tests cover them),
but the UI can no longer create a second column.
| `module.setHeight` | `{ instanceId, height }` |
| `module.setCollapsed` | `{ instanceId, collapsed }` |
| `column.setWidth` | `{ paletteId, widths: [{ columnId, width }] }` |
| `palette.rename` | `{ paletteId, name }` |
| `palette.close` | `{ paletteId }` (refused for the last palette) |
| `palette.create` | `{ pos?, size? }` |
| `palette.setCollapsed` | `{ paletteId, collapsed }` |
| `palette.setSnap` | `{ paletteId, snap, snapTo }` |
| `module.enable` / `module.disable` | `{ moduleId, paletteId?, lone?, instanceId? }` |
| `module.show` | `{ instanceId, paletteId?, lone? }` — re-enable a hidden instance |
| `palette.import` | `{ palette }` — a palette from a file; its ids are re-minted |
| `workspace.import` | `{ doc }` — **main only** |
| `palette.setBounds` | `{ paletteId, pos?, size? }` — **main only** |
| `workspace.load` | `{ doc }` — **main only** |

`lone: true` puts the newly enabled/shown instance in a **new column of its own**;
Settings Add/Show/Duplicate and module import use it. The one-time upgrade seed
omits it and keeps appending.

`layout.place` is the single drag/drop intent; the drop matrix below is its
target union. Every intent is validated (sender owns the palette, ids resolve,
the module is in the registry, numbers are finite) and a rejected intent changes
nothing.

**Settings → Layout** lists every palette as a row: an expand arrow, the name
field, its module count, and duplicate / export / delete icons. Expanding a row
lists its module instances, each with disable (hide), pop-out and remove icons;
the section header imports one palette (`palette.import`), and the Whole
workspace row exports or imports the whole document. `palette.export` writes one
palette as `{ kind: 'iroiroppa-palette', palette }`; an import accepts that or a
bare palette object.

## The pure core

| File | What it is |
| --- | --- |
| `src/shared/layout-model.js` | `reduce(doc, intent, opts)` → `{ ok, doc, effects, error?, noop? }`, `normalise`, `defaultWorkspace`, and the queries (`instanceRef`, `paletteOfInstance`, `moduleCount`, `totalInstances`). UMD: main and the renderer share it. |
| `src/shared/layout-geometry.js` | `columnWidths`, `moduleRects`, `contentSize`, `minSize`, `grownSize`, `paletteRects`, `isContentFit`. No DOM; a caller injects the measured content heights. UMD. |
| `src/main/layout-store.js` | layout.json on disk: atomic write, the v1 → v2 migration, and a corrupt-document backup. Electron-free. |
| `src/main/layout-service.js` | **the only writer**: the workspace document in memory, the revision counter, the debounced save, and `apply(intent)` / `writeV1(doc)`. |
| `src/main/layout-view.js` | the v1 file/import mapping (`applyV1Doc`) and `docToV1` for the legacy channel — no longer the board's read/write path. The `weight` ↔ height mapping is `src/shared/layout-codec.js`. |
| `src/main/json-file.js` | the atomic JSON write and the corrupt-file backup both stores share. |

`reduce` returns **effects** for the window layer, because a size decision needs
the geometry layer: `palette.open`, `palette.close`, `palette.fit`
(`change: grow | columns-added | content | content-fit`) and `palette.apply`
(collapsed/snap changed). Main turns those into window calls.

## The drag session (main)

Phases: `idle → armed → active → dropped → idle`.

- **armed** — a renderer reports `pointerdown` on a draggable (a module header, or
  a titlebar for a whole palette) with the selection captured at that moment; a
  move past 12 px makes it active, Escape cancels.
- **active** — main polls `screen.getCursorScreenPoint()` (~16 ms). Each tick it
  hit-tests the cursor against live palette bounds (topmost = the last palette
  interacted with), converts the point into that palette's local CSS px, asks its
  board to resolve the landing point, then draws chip + indicator in the overlay.
- **dropped** — main re-resolves, dispatches the one `layout.place`, and the
  source keeps or reverts its optimistic change from the outcome.

Boards never draw indicators and never mutate layout during a drag; they answer
one question per tick and render the snapshot they are given.

**Overlay** (`overlay.html`, replacing `overlay.html`): one transparent,
click-through, always-on-top window covering the union of the displays, carrying
the drag chip *and* the destination indicator. This is what keeps the indicator
above every palette, and it removes the column-overflow clipping of the old
in-board indicator. The 500 ms band watch may hide it only when no menu,
tooltip, merge card, or drag owns it (`shared/overlay-ownership.js`); the window
`show` handler uses the same predicate, because the old menu/tooltip-only check hid
the drag chip/lines and merge card the instant they appeared. Menus/tooltips are
re-raised after the owner window (immediately and on the next tick), so the 500 ms
watch is not what makes them visible. On every draw it re-asserts the full work-area
bounds, because a menu or confirm card may have shrunk it.

**Selection**: click selects one, shift-click extends in document order (column
order, then module order), ctrl-click toggles, Escape/empty space clears. Dragging
any selected module drags the whole selection, in document order; a selection
lands as **one** run (one column on a seam, one sequence in a column, one new
palette).

## Panes (windows)

All of this lives in `src/main/panes.js` (replacing `panes.js` and the float half
of `windows.js`):

- **Lifecycle from the document**: `palettes[]` → windows on load; the
  `palette.open`/`palette.close` effects create and destroy. No `reopenFloats`, no
  `floatWins` map, no cap.
- **Bounds**: main resolves `pos`/`size` through `window-bounds.js` (the existing
  per-monitor clamping); OS `move`/`resize` update the document.
- **Moving**: `-webkit-app-region: drag` on every titlebar, with `win.on('move')`;
  the cursor poll drives snapping during the drag. The palette's custom
  `attachTitlebarDrag` and its corner grip are deleted, and the OS edges resize
  when unlocked.
- **Snapping**: all four edges (`SNAP_TOL` 8), persisted, restored on open.
- **Collapse**: persisted in the document (`collapsed`), and a collapsed palette
  reopens collapsed with its real size intact. A lone module keeps its header, and
  the bar keeps its natural height (Windows floors a frameless window at ~39 px).
- **Lock**: global, size-only; layout moves stay allowed while locked.
- **Zoom / UI scale**: global, re-applied on `did-finish-load`; sizes stay in CSS
  px so they never compound.
- **Auto-hide**: the follow-CSP-focus rule is global and applies to every palette;
  the tray's show/hide toggles all, and "Bring palettes back on screen" re-clamps
  all. Keep-awake means *any* palette is visible.
- **QR scan parking**: parks the palette the scan was started from (the last
  interacted with) and restores it, exactly as today.
- **Settings**: one singleton window, opened from the gear in any palette's
  titlebar. The per-module popout window is retired in favour of Settings.
- **A palette shows its own name**, and it can be renamed in place; the app name
  lives in Settings now, not in a window's header. The name is a plain text input,
  so it uses the window's normal editable-focus dance (the window is
  non-activating), and in a float the field carries
  `-webkit-app-region: no-drag` because the grip is an OS drag region — as every
  interactive element inside the grip must.
- **The last palette is never auto-closed.**

## Size rules

One place (`layout-geometry.js#grownSize`):

| Change | Width | Height |
| --- | --- | --- |
| New column at an outer edge | `+= the new column's width` | up to the content minimum |
| Insert at a seam | unchanged | up to the content minimum |
| Insert into a column | unchanged | up to the content minimum |
| New palette (drop on the desktop) | content fit | content fit |
| A palette whose modules all fit their own size (`auto`/`ratio`/`rigid`) | content | content (grow *and* shrink) |

No operation shrinks a palette except content fit; everything then clamps onto a
live work area.

## The drop matrix

Payloads: **M1** one module · **M2** shift-selection · **P3** whole palette.

| payload ↓ / dest → | Column (index) | Seam | Outer edge | Desktop |
| --- | --- | --- | --- | --- |
| **M1** | insert at index, size unchanged | new column, size unchanged | new outer column, width grows | new palette, module-sized |
| **M2** | one run at the index | one new column | one new outer column | one new palette, one column |
| **P3** | its modules merge into that column, in order | its columns inserted, width grows by their total | its columns inserted outside, width grows | no-op |

Guards: a drop on its own position is a no-op; a selection dropped inside its own
span has its index adjusted; P3 on itself is a no-op; a P3 dock that would delete the
dragged palette asks first (`drag-session.js` returns `pendingMerge`, main draws the
overlay card; Cancel restores the original rectangles); a drop while locked is
allowed; a palette emptied by a drop closes (unless it is the last); the dropped
items' order, count and heights are preserved exactly; a rejected drop leaves the
document unchanged.

Each cell and guard is a table-driven test in `test/drop-matrix.test.js` (V5),
plus one `--shot` per destination kind.

## Migration

`layout-store.js#migrateV1` reads a v1 `{ columns, floats }` document plus
`settings.json`:

1. The palette keeps its columns and takes its placement from
   `windowBounds` (falling back to the older `windowPos`/`windowSize`).
2. Each float becomes a palette (`floatId` → id, `x`/`y` → `pos`, `width`/`height`
   → `size`), and one from before float boards existed becomes a one-module
   palette.
3. **A v1 `weight` maps losslessly**: a stored weight is a `fill` share, and a
   `null` weight is `auto` for a module that declares `autoHeight` (the registry
   says which) and otherwise v1's `DEFAULT_WEIGHT`. No pixel estimate, so nothing
   shifts on upgrade. Without a registry every null weight becomes a `fill` share,
   which is the documented fallback.
4. Names are "Palette 1"… by document order, with `nextPaletteNumber` after the
   last; `snap` is kept and anchored to the palette.
5. A corrupt document is copied to `layout.json.bak` and read as absent — it is
   never overwritten blindly.

## One palette

Nothing about the first palette may be special. Today it alone carries the CSP connection
notification, the green connection light, the profile switcher, the settings gear and the bottom
bar (history, hex, the proof chip, the lock) — so "float a module and you get a different kind of
window" is still true.

Target:

1. **The bottom bar becomes a module, `color-stat`** — HEX plus the colour's numbers (LCH, RGB and
   whatever else belongs), drawn like any other module, so it can be floated, duplicated, hidden,
   dragged and configured per instance. **The lock-layout button is dropped for now**
   (``): locking is a setting, not a per-palette control.
2. **A `session` module** — a **singleton** (not instanceable), the only module that is: CSP
   connect status and the connect/disconnect action, the green light, the profile switcher, and
   the entry point to Settings. It renders the same in every palette. Because Settings must always
   be reachable, the **tray menu gains a Settings item** and the per-palette gear goes away.
3. **Main keeps the state and every palette mirrors it.** No behaviour moves into the first
   palette: the CSP colour, connection status, profile and history are already main-owned
   broadcasts (`companion:color`, `status:changed`, `settings:changed`, `history:changed`), so this
   is a module-host job, not a plumbing one. Reusing the manifest's existing `instanceable: false`
   is what makes `session` unduplicatable.
4. **Migration**: the shell loses its footer (`index.html`), and the workspace gains a `color-stat`
   and a `session` instance in the first palette so an existing layout loses nothing on upgrade.
5. **Order**: (a) the tray Settings item and the gear removal; (b) the `session` module; (c)
   the `color-stat` module; (d) the shell loses its footer; (e) docs, `npm run screenshot`, changelog.

Built. What the work settled, and what a later change must not undo:

- **`session` is one row and nothing else.** It declares `headless` (the host mounts it with no card
  head, so there is no second header) and `rigid` (it keeps its own height even alone in a column).
  Its minimum width is **measured from the controls**: the dot, the profile dropdown, the lock and
  the gear; the dropdown ellipsises rather than forcing the palette wider.
- **The profile dropdown, not an icon.** The row is `● [Profile ▾] [🔒] [⚙]`; the dropdown opens the
  profile switcher, which reuses the Settings window's own rows (`.profile-pinned`, `.profile-item`,
  `.profile-list`) as a *fixed-position* panel — an in-card popup is clipped by the column's
  `overflow: hidden`. The connection's name/state lives on the dot's tooltip (“Connected to Clip
  Studio Paint”). Disconnect lives in the module's own ⋯ panel and the tray, never in the row.
- **`color-stat` is one line too.** Swatch, HEX (copy/paste/type), **one** coordinate cell (click it
  to cycle the document's L/C/H ↔ the screen's sRGB; the choice is a module setting, because a board
  rebuild would otherwise reset it). If a profile makes the two spaces disagree, the tooltips say
  which is which. A ΔE-against-the-previous-colour row was tried and **removed**: in a picker the
  comparison that matters is against something outside the app, not against the last colour.
- **A lone module is a palette**: see `docs/INVARIANTS.md` — it keeps its shell and its module mounts
  headless, and every palette's hamburger lists its modules' settings.
- **A module minimum includes its head** (`_minHeightOf`), so a resize can never crop a card.
## Snapping

Snap **zones** were built and then removed: four bands to aim at, with the dragged window hidden
behind a name chip, was more machinery than the gesture needs and it broke the two things that
matter (a palette could not be moved where it was dropped, and a palette could not be docked). The
rule is now the simple one:

- **A palette moves live.** Dragging a palette's titlebar moves the window with the pointer — you
  see exactly where it is going, so nothing has to be drawn to stand in for it.
- **Proximity is the whole snap rule.** On release, the palette joins the nearest edge of another
  palette if that edge is within `SNAP_TOL` (14 px) and the two overlap on the other axis; it
  flushes against it and the pair becomes a **snap group**. Released anywhere else it stays put and
  **comes free** of any previous join. Nothing is joined by merely being close *while* you drag:
  the join is decided once, on release.
- **Released over another palette, it docks instead.** The drop indicator appears while the pointer
  is over another palette, and on release that palette's modules move into it (`layout.place`) —
  the same indicator and the same commit a module drag uses.
- **A module's own header always drags the module**, in every window — including a lone module,
  whose header used to lift its window instead.
- The relationship is the document's existing `snap` (which of the anchor's edges this palette sits
  against) and `snapTo` (the anchor). A **group moves as one**: a group is the connected component
  of that graph, so membership stays derived and nothing extra is stored. Main follows the graph
  (`snapFollowers` → `followSnapGroup`), never a map a join would have to remember to update.
- **The shared edge is a splitter.** Resizing either window's touching edge moves the shared
  boundary and adjusts the neighbour so the pair stays flush and the group's outer edge stays put;
  resizing an outer edge leaves the neighbour alone. Both windows clamp to their boards' reported
  minimums (`layout-geometry#reflowSnapResize`). A content fit (`window:resize-self`) pins the shared
  edge by moving the window by the size delta.
- **Unsnap is a titlebar icon**, next to the hamburger, shown while the palette has `snap` or has
  followers. A follower detaches itself; an anchor releases its direct followers. The hamburger no
  longer carries the entry.
- **Every window fits its content**: a float with only natural modules shrinks to its cards after a
  resize, exactly like the palette. It only ever resizes itself (`resizeSelf`), never the palette.
- **The size rule is one rule, in one place** (`fitPane`, main), in CSS pixels:
  - a **new column** → **+ the item's drawn width + the seam** (8 px);
  - a **row** → **+ the item's drawn height + the gap**;
  - a **column that leaves** → **− that column's drawn width − the seam**;
  - anything else that leaves → **− the item's drawn height − the gap**.
  A **docked palette** uses the same rule with its own window size: docking at a vertical edge adds
  its **width**, docking at a horizontal edge (into a column) adds its **height**. Windows **grow
  and shrink** — a window that only ever grew inflated with every drag — clamped by the board's
  reported minimum and the display's work area. Measurements come from the board's drawn boxes; the
  document's widths are hints.

## Phases

| Phase | Deliverable | State |
| --- | --- | --- |
| **V1** | `layout-model.js`, `layout-geometry.js`, `layout-store.js` + `migrateV1`, headless tests. No behaviour change. | ✅ |
| **V2** | The registry and the writer: the shared module manifest, safe JSON writes, then main owning the workspace document with the board rendering it. | ✅ manifest + safe writes + **main owns the document** (the board and the float layer write through the service's lossless v1 view). Then: fine-grained intents replaced the whole-document write (the drag session in V4); a board's own `_save` still writes its `columns` through the v1 view, which is the transitional path, and `palette.close`/`workspace.load` are the only things that remove a palette. |
| **V3** | Equal palettes: naming + rename, main-owned geometry, one moving mechanism, collapse/snap persisted, the lock/zoom/tray/auto-hide/keep-awake/parking rules, the titlebar shows the palette's name, `floats.js` goes. | ✅ done — naming shown + rename ✅, geometry (float **and** the palette: `settings.json#windowBounds` is legacy now) ✅, all four snap edges ✅, collapse persisted for both ✅. The moving mechanism landed with V4 (a main-side session with a cursor poll and snapping), and `floats.js` → `panes.js` after it. |
| **V4** | The drag session + the overlay + selection. | ✅ done — the **drop resolver** ✅ (`src/shared/drop-resolve.js`, tested; a pane's **drawn boxes win** over the model, which is why the old `executeJavaScript` probe existed), the **overlay** ✅ (one full-desktop click-through surface for the chip *and* the indicator; `overlay.*` is it, the rename is V6 tidying), the **drag session** ✅ (`src/main/drag-session.js`: one phase machine owning the cursor poll, resolve, draw, commit and cancel, tested with an injected clock), the **board report** ✅ (each board sends what it drew; `paneList()` + `--resolve-drop` prove it against the live app) — and **both drag paths** (the palette's module drag, a lone float's header hand-over) go through the session, with a real pointer drag verified by `--pointer-drag`, and **selection** ✅ — shift ranges over document order (columns, then modules), ctrl/Cmd toggles one, a plain press keeps an existing selection, and a drag carries the whole selection as one payload. `rangeBetween`/`documentOrder` are unit-tested and the wiring is verified live (`--select i1,i3` + `--pointer-drag i1` → document `[["i1","i3","i2"]]`; `--shift-select i1,i3` → `["i1","i2","i3"]`). The v1 bookkeeping that was dead has since been deleted (V6). |
| **V5** | The drop matrix as tests, and a `--shot` per destination kind. | ✅ `test/drop-matrix.test.js` — 17 tests over payload × destination (one module, a selection, a whole palette; column body, seam, both outer edges, the desktop) plus the guards (the last palette never left empty, unknown instance, mixed source, bad target, no items) and a conservation check that no cell loses or duplicates a module. The `--shot` half is the flag set: `--resolve-drop` (the resolver against the live panes), `--pointer-drag` (a real pointer drag through the session) and `--board-drag i3=left` (the outer-edge cell). |
| **V6** | Delete the old world; rewrite the layout sections of the docs. | ✅ done — the **effects are consumed** ✅ (`palette.open` opens the window sized from the box the module was drawn in, `palette.close` closes it, `palette.fit` grows it by the inserted column and never squeezes) and a float's id is its palette id. The renames (`floats.js` → `panes.js`, `ghost.*` → `overlay.*`) and the doc section rewrite all landed in this phase. *Deleted*: the whole v1 drag bookkeeping — the renderer's `onModuleHover` block, `_updateDropTarget`, `_drop`, `_dropExternal` (112 lines, brace-matched so the cut could not land on a blind line number) and, in main, `hoverModule`, `float:add`/`module:hover`/`module:drop`, `floatAdd`/`moduleHover`/`moduleDrop` and `dropModule`. |
| **N1** | Per-instance module settings (`modules/<instanceId>.json`), Settings → Modules becomes module · instance · settings. | ✅ `modules/<instanceId>.json`, falling back to the module's own file, so every existing setting carries over; the module popout and the Settings → Modules detail each edit the instance in front of you (an instance strip: "defaults" plus one chip per mounted instance). **Instance controls** followed: **+ Add** (hidden for a singleton), **Duplicate** (a copy of the selected instance's settings), **Hide**/**Show** (kept with its settings, mounted nowhere — recorded in `hiddenInstances`), and **Delete**. |
| **N2** | Singleton modules (`instanceable: false`) and chrome → modules (CSP Color, the profile switcher, the footer); the gear in any titlebar opens Settings. | ✅ **Done**: the singleton rule is enforced and tested (the model's `module.enable`), the Modules tab says a module is a singleton, the gear in any titlebar opens Settings, and **chrome → modules landed** — the footer is the `color-stat` module, the connection banner, profile switcher and proof icon are the `session` module, and the slots are `csp-color`; only the titlebar stays chrome by design (`docs/MODULES.md`). |
| **N3** | Layout & Workspace Manager: rename, duplicate, export/import a palette or a whole workspace. | ✅ `palette.duplicate` (new instance ids, offset, opened by an effect), `workspace:export`/`workspace:import` (a v1 file migrates on the way in), and a **Layout** tab in Settings: the palette list with an inline name field and Duplicate, plus Export…/Import…. Later: **named saved workspaces** (`src/main/workspace-store.js`; load / rename / delete plus Save in the Layout tab) and **settings export/import** in General. |
| **R-API** | The external API. The intent set above is its substrate; the scope (transport, auth, read/write surface, versioning) is settled then. | |

**Main owns the document.** `src/main/layout-service.js` holds the workspace in memory
and is the only thing that writes `layout.json` (atomically, debounced, from one place).

**Two write paths, and know which one you are on.** The way forward is an **intent**:
a renderer dispatches and the pure reducer produces the next document.
`layout-view.js` is the **transitional** second path — its `applyV1Doc` maps a v1
document onto the v2 one, and `layout-service.js#writeV1()` is what the float layer
and the palette's own save still call (`ctx.writeLayoutDoc` in `main.js`), with the
legacy `layout:changed` broadcast still carrying that v1 shape to the board. It is
kept lossless on purpose (see the codec below) so the two paths cannot disagree
while both exist; it goes when the last caller becomes an intent.

Every window addresses **its own palette**: `palette:columns:get` / `palette:columns:set`
resolve the palette from the *sender*, and the `layout` domain carries the v2 document, so
each board picks `doc.palettes.find(p => p.id === its own id)`. A window can no longer
read or write another palette's columns, and `float:columns:get/set` are gone.

The `weight` ↔ height mapping lives in `src/shared/layout-codec.js` — the board's v1
column vocabulary against the document's v2 `height`. It is **lossless**: a v1 `weight` is
a `fill` share, `null` is the module's own default (`auto` for an `autoHeight` module,
else v1's default share), and a `px` height reads back as `null` and survives a `null`
write, because a v1 board has no way to express one and so can never need to change it.

**The module registry** (`src/shared/module-manifest.js`) is the one list of module
ids and their metadata, read by main (the Settings → Modules list, the layout
model's registry) and by the renderer (what to mount, and the first-run board), and
`npm test` checks it against the files on disk in both directions.

## Deleted in V6

`src/main/floats.js` (its job becomes `panes.js`), the old `ghost.js`/`ghost.*`
(now `overlay.js`/`overlay.*`), `module-settings.*`,
`src/renderer/kernel/layout.js` (a view and a resolver instead),
`float.*`, the palette's custom titlebar drag and resize grip,
`dock:target`, `float:remove`, `unitAbove`/`unitBelow`, `_fitLoneFloat`, and the
five timers (`lastFollowAt`, dock-arm, `settleChecks`, `_resizeGraceUntil`,
edge-hint). Already gone: `board-store.js`, the second writer of `layout.json`,
superseded by `layout-service.js`.

**Not gone yet, and the docs must not pretend otherwise.** `layout-view.js` and
the v1 `weight` key are still live: the board's read/write path is
`palette:columns:get/set`, and in main a float's geometry is still written through
`writeV1()` (`ctx.writeLayoutDoc`), which is why `layout-service.js` keeps a `v1()`
view and `main.js` keeps `floatWins`/`floatSnap`. A window's own columns no longer
travel on `float:columns:get/set` — that channel is deleted — but the legacy
`layout:changed` broadcast still carries the old shape for the float and board
paths that have not yet become intents. Deleting the view is the last item here,
not a finished one.

## Risks

- `-webkit-app-region: drag` on the non-activating palette is proven on the float
  grip but must be verified on the palette in V3; the fallback is the existing
  `moveBy` behind the same session API.
- The overlay must sit above palettes and CSP (`screen-saver`, raised after the
  owner window); never `moveTop()`, which drops the topmost band.
- Overlapping palettes resolve to "topmost = last interacted with" — a rule, not
  an OS fact; documented here so it is not rediscovered.

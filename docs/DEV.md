# Development

## Running

```powershell
npm install
npm start          # or: npm run dev   (devtools, window stays open on blur)
npm test
```

## Verifying UI changes without clicking

`main.js` has flags for scripted verification. The `--shot` flow loads the
window, optionally drives it, writes a PNG and prints a JSON summary of the
renderer state, then quits. The dump's `ui` field is a small hygiene check run
inside the window: interactive targets under 12 px (`small`) and clipped text
(`overflow`), with `n`/`boxes` counting what it inspected. Take the shot at more
than one `--size` — clipping only shows at the narrow end. `winAt` is the window's
screen position (`--pos` sets it), and note that placement saving is deliberately
muted while the palette is parked for a scan and for ~600 ms after, so a placement
test needs `autoConnect` off.

```powershell
# the current colour, proof mode, recorded #BFFFFB (should show the vivid cyan)
npx electron . --shot out.png --mode proof --pick "#BFFFFB"

# the colour-profile picker (drawn by the overlay, so it may leave the palette)
npx electron . --shot out.png --profiles

# ... and pick a row of the overlay menu: 0 = default sRGB, 1 = Browse, 2+ = profiles
npx electron . --shot out.png --profiles --profile-row 3

# report every palette/float window's bounds (snap-splitter and float-fit checks)
npx electron . --shot out.png --report-panes

# pick a colour, then switch to the background slot
npx electron . --shot out.png --pick "#A3F75B" --click sub

# check that closing Settings does not hide the window
npx electron . --shot out.png --settings-cycle

# minimum size
npx electron . --shot out.png --size 200x400
```

The JSON summary includes the slot classes/backgrounds, the swatch, the hex, the
mode status, the profile name and the chroma-axis maximum — usually enough to
confirm a change without looking at the image.

The flags are parsed in `src/main/main.js`, which is the source of truth.

## Testing against Clip Studio Paint

Only **one controller** can be connected at a time, so quit the app before using
the probe, and vice versa.

```powershell
npm run probe                      # scan the screen for the QR and read the colour
npm run probe -- --set "#4DF7F8"   # also write a colour
npm run probe -- --watch           # poll until Ctrl+C
```

In CSP: *File ▸ Connect to smartphone*, leave the QR visible.

## Working without Clip Studio Paint

`scripts/fake-host.js` speaks enough of the protocol to drive the UI:

```powershell
node scripts/fake-host.js            # fixed colour
node scripts/fake-host.js sub        # background active
node scripts/fake-host.js transparent
node scripts/fake-host.js main 46010 cycle   # changes every 300 ms
```

## Pointer / canvas probe

`pointer.ps1` reports left-button down/up over CSP and flags a canvas contact:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File src/main/pointer.ps1 -Probe -Seconds 20
```

Click the canvas and then the Colour Wheel: the canvas line is `canvas=True`, the
wheel is `canvas=False`. That flag is the detector behind History's "Record only
while drawing" setting.

Then point the app at it by writing a `session.json` whose `ips`/`port` match,
into `%APPDATA%\Iroiroppa\session.json`, and start the app normally.

## Colour-profile tests

The proof tests use the committed `src/assets/synthetic.icc` (rebuilt with
`npm run icc` from `src/shared/synthetic-icc.js`), a minimal ICC v2 matrix/TRC
profile, so they run on any machine. The tests that assert the real wide-gamut
observations look for a suitable profile in the Windows colour directory or
`D:/Download`, and skip (visibly) when it is absent.

## Release checklist

See `docs/RELEASE.md` — it is the single checklist, and the `release` skill
carries the non-negotiables.

## Development flags

`src/main/main.js` understands these, which is how the UI is verified without a
human clicking:

| Flag | Effect |
| --- | --- |
| `--log` | print service status/colour transitions; forward renderer console |
| `--dev` | devtools; keep the window open on blur |
| `--shot <png>` | screenshot the window, dump renderer state as JSON, then quit |
| `--size WxH` | force the initial window size |
| `--resize-window WxH` | resize the palette the way the OS would (exercises the board's own user-drag handling) |
| `--mode default\|proof` | pick a colour mode before the shot |
| `--proof-model working\|colorimetric\|display` | set the appearance model (**`--shot` only**) |
| `--profiles` | open the colour-profile popup |
| `--menu-shot <png>` | with `--profiles`, capture the overlay menu itself (its own window) |
| `--trace-focus` | print foreground changes and the immediate hide/show decision to stdout |
| `--capabilities <id[,id…]>` | force capability channels on before the shot |
| `--cap-off <id[,id…]>` | force capability channels off (renders the "unavailable" state) |
| `--legacy-state` | fall back to the legacy per-domain channels instead of the canonical model |
| `--no-peer-bus` | disable the per-window `MessagePort` peer transport |
| `--no-compute-host` | decode QR in main instead of the `utilityProcess` host |
| `--no-secret-store` | store the pairing secret in plaintext instead of `safeStorage` |
| `--capture-fake <name>` | list a synthetic capture source (renders the capture module without a desktop) |
| `--profile-row <n>` | click the n-th profile row (with `--profiles`) |
| `--pick <#RRGGBB>` | type a hex and commit it (simulates a user pick) |
| `--chroma <n>` | drive the C slider (may sit past the gamut boundary) |
| `--module-popover <id>` | open that module's settings window (clicks its ⋯ button) |
| `--open-popover <moduleId>[=<instanceId>]` | open a module-settings window directly (does not depend on a hover button) |
| `--popover-shot <png>` | capture the module-settings window (pair with `--open-popover`) |
| `--palette-menu` | click the palette's ☰ and report where the menu landed: the overlay window's real bounds, the palette's bounds and the menu's items (the menu is drawn by the overlay, so this is how "it left the palette" is checked) |
| `--module-toggle <id>` | with it, click the first control in that settings window |
| `--board-size <id>=<px>[,…]` | resize a column id or module instance (palette) |
| `--board-move <instance>=<columnId>` | move a module between columns |
| `--board-drag <instance>=<spec>` | drop a module: `left`/`right` edge or `<columnId>[:index]` |
| `--board-add-column` | add a column (palette) |
| `--rename-palette <name>` | rename the palette window through its own board (verifies the `palette:rename` path) |
| `--float <instanceId>` | float a module into its own window |
| `--float-collapse <instanceId\|floatId>` | click that float's collapse eye (its grip, or a lone module's header) |
| `--hover-float <instanceId\|floatId>[@left\|right\|top\|bottom]` | hover an external module over a float (shows the cross-window drop indicator) |
| `--drag-hover <instance>=<floatId>` | start a real drag in the palette and move it over the float, then report the indicator |
| `--dock-at <instanceId\|floatId>=<fx>,<fy>` | dock a whole float at a palette-relative fraction (verifies merge-into-column vs insert-at-seam) |
| `--reclamp` | pull every float back into a live work area (the unplugged-monitor path) |
| `--dock <instanceId>` | click the Dock button in that float window (accepts a float id too) |
| `--float-near <instanceId>` | move that float over the palette (with 2+ modules it docks by overlap; a shot cannot move the OS cursor) |
| `--drop-float <instance>=<floatId>[@left\|right\|bottom]` | drop a palette module onto a float (verifies the cross-window drop) |
| `--drop-main <instance\|floatId>[@left\|right\|middle]` | drag a float's module back onto the palette (a window id picks its first module) |
| `--drop-none <instance\|floatId>` | drag a module out to empty space (a new float) |
| `--drop-self <instance\|floatId>` | drop a float's module back onto its own window (must stay put) |
| `--dock-hint` | show the palette's "a float will dock here" indicator |
| `--drag-overlay <name>` | show the drag chip window (the shot then captures it) |
| `--drop-line <x,y,length,h\|v>` | with `--drag-overlay`, also draw a drop indicator, in screen pixels |
| `--resolve-drop <x,y>` | print what a drop at that screen point would do, against the live panes |
| `--session-drag <instance>,<x>,<y>` | drive the drag session (begin → tick → drop) at a screen point and report the plan and the document |
| `--select <a,b,…>` | select instances in a board, so a following `--pointer-drag` carries the whole selection |
| `--shift-select <a>,<b>` | shift-press from a to b through the real handler and report the resulting range |
| `--pointer-drag <instance>,<x>,<y>` | the same, through the board's real pointer handlers: dispatches pointerdown/move/up with the cursor parked on the point |
| `--click <selector>` | click anything by CSS selector in the palette (or in a float with `--click-win <id>`); reports whether it was found and whether a Settings window is open |
| `--click-win <floatId>` | which window `--click` acts on (default: the palette) |
| `--duplicate-palette <id\|primary>` | duplicate a palette and report the document's palettes and their instances |
| `--delete-palette <id\|primary>` | delete a palette (and everything in it) through the reducer, and report what is left |
| `--listeners` | how many IPC listeners each renderer holds — a rebuild must not add any (see the module-leak rule in `docs/INVARIANTS.md`) |
| `--export-workspace <path>` | write the workspace (the document) to a JSON file |
| `--import-workspace <path>` | replace the workspace from a JSON file (a v1 file is migrated) |
| `--module-add <moduleId>` | mount another instance of a module |
| `--module-duplicate <instanceId>` | a second instance, starting from that one's settings |
| `--module-hide <instanceId>` / `--module-show <instanceId>` | hide an instance (mounted nowhere, settings kept) / mount it again |
| `--module-remove <instanceId>` | delete an instance for good, placed or hidden |
| `--summon-hotkey <accel>` | register a system-wide palette show/hide hotkey (e.g. `Ctrl+Alt+P`) and print whether it took — the summon-hotkey path |
| `--user-module <dir>` | use `<dir>` as the user-modules folder instead of `%APPDATA%\Iroiroppa\user-modules` (it must hold `<id>/module.js`), for a scripted load |
| `--bind <instanceId>:<command>=<accel>[,<key>=<accel>…]` | register per-module command hotkeys and print which took (a clash is reported, `docs/MODULES.md` "Module commands") |
| `--command <instanceId>:<name>[,<json args>]` | call a module command through the kernel bus from the palette renderer (retries ~3 s while the target mounts) and print the result — the end-to-end check for `docs/MODULES.md` "Module commands" |
| `--settings-shot <png>` | with `--open-settings`, capture the Settings window itself (bounds + visibility + PNG) — for "the window is blank" reports |
| `--settings-shot-late <png>` | capture Settings **after** the tab/module/click actions (the normal shot is taken before them) |
| `--settings-debug` | print the Settings window's live workspace, hidden instances, dots and module lights |
| `--settings-click <selector>` | click anything in the Settings window by CSS selector |
| `--settings-click-2 <selector>` | a second Settings click, after `--settings-click` |
| `--lock` | lock the layout (also reports the windows' resizable state) |
| `--pos <x>,<y>` | place the palette (keeps float tests on screen) |
| `--move-float <floatId>=top\|bottom\|left\|right[,<gap>]` | drop a float off that edge (verifies snapping) |
| `--module-hover left\|right\|top\|bottom\|middle` | hover an external module over the palette |
| `--module-set <id>=<key>:<value>` | patch a module setting as another window would |
| `--module-size <moduleId>=<ratio>` | set a module's locked height:width ratio (its first placed instance) |
| `--settings-module <id>` | with `--open-settings`, select that module in the Modules tab |
| `--settings-toggle <n>` | with `--settings-module`, click the n-th control in that module's detail pane |
| `--hex-click` | click the hex field (copies it) and report the flash |
| `--shot-wait <ms>` | delay the `--shot` capture (e.g. to let a connection settle) |
| `--shot-brief` | print only the key numbers from the renderer dump (cheaper when a picture is all you need) |
| `--eval <js>` | evaluate a JS expression in the palette and print the result (generic UI probe) |
| `--transparent` | mark the colour transparent (to check the dimmed modules) |
| `--click main\|sub\|transparent` | click a colour-slot strip segment |
| `--settings-cycle` | open Settings, focus a text field, close it; report visibility |
| `--open-settings` | open the Settings window |
| `--settings-tab general\|appearance\|modules\|layout` | with `--open-settings`, select that tab |
| `--accent-popup` | with `--open-settings`, open the accent picker popup |
| `--ui-scale <n>` | set the UI scale (0.8–1.6) before the shot |
| `--theme <id>` | set the theme before the shot (`light`/`dark` also work) |
| `--pair` / `--set <#RRGGBB>` / `--exit-after` | auto-pair and write a colour, then exit |

Example: `npx electron . --shot out.png --mode proof --pick "#BFFFFB"` then read
`out.png` and the dumped JSON.


## Build and run

After **any** code change, build the packaged app and launch it for testing —
do not leave the user on `npm start` / dev mode:

```
npm run pack:run      # electron-builder --dir, then launch dist/win-unpacked/Iroiroppa.exe
```

`npm run pack` alone produces `dist/win-unpacked/Iroiroppa.exe`; `scripts/launch-packed.js`
kills any running Iroiroppa first (a second instance silently defers to the single-instance
lock and looks like "nothing happened"), then starts it. Kill by command line, never by
process name alone — other Electron apps run on the build machine.

To exercise the **portable** layout without packaging, set
`PORTABLE_EXECUTABLE_DIR` to a folder you own before launching: the app then
keeps its state in `<folder>\Iroiroppa Data` instead of `%APPDATA%\Iroiroppa`
(that variable is what electron-builder's portable stub exports at run time).

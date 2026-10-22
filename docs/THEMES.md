# Themes

> **Shipped.** A theme is a token set plus an optional sibling `<id>.css`. The
> tokens are declared once in `src/shared/theme-tokens.js`, applied by
> `src/renderer/kernel/themes.js` as a `:root <style>` block, and checked by
> `npm test` and `npm run theme:check`.

## Goals

- A theme restyles **anything**, not just colour.
- It costs **nothing while the app is running**: no per-frame work, no animation,
  no continuous repaint.
- It cannot silently break the app or the window layout.
- Authoring is plain files (JSON + optional CSS); no build step, no dependency.

## Two kinds of token

The line that matters is **whether a value can change an element's measured
size** — its `getBoundingClientRect()`, or a module's `minSize()`.

| Kind | Changes geometry? | Examples | App must react? |
| --- | --- | --- | --- |
| **Paint** | No | colour, `--shadow`, `--radius`, gradients | No |
| **Structural** | Yes | font family, font size, spacing | Re-measure + re-clamp |

`--radius` is **paint**: `border-radius` never reflows, so shape is free.

## The model

1. **Tokens (validated)** — the fast, safe path. A theme's `tokens` map is
   checked against the schema in `src/shared/theme-tokens.js`; an unknown token
   is ignored, a bad value falls back to the default.
2. **Theme CSS (expressive)** — an optional sibling `<id>.css`, injected after
   the base stylesheets, restyles what the tokens do not reach.
3. **Assets (static)** — fonts and images are loaded once.

## v1 token set

- **Structural (bounded):** `--font-ui`, `--mono`, `--font-size`, `--space`.
- **Paint:** the colour tokens, `--shadow`, plus `--radius`.
- **Bundled fonts:** Inter and DejaVu Sans (DejaVu is Blender's own UI font),
  named through `--font-ui` / `--mono`.

How far the structural tokens reach today: `--font-size` drives every text rule
(a `calc` offset from the base), `--space` drives the module card padding, and
`--radius` the shell/popup corners. Two deliberate exceptions: the palette-name
input keeps a literal `11px` (it is sized `11ch`, and a `var()` font-size moves
the titlebar icons by a sub-pixel), and the per-control fine radii stay local.
Extending a structural token's coverage is adding a `var()` use, then proving the
default render is unchanged (`npm run screenshot` must not change the image).

Each structural token is bounded (min/max) so a theme cannot make a module
unusable. Layout changes go **only** through structural tokens — never through
arbitrary CSS, because the app cannot see a size change it did not declare.

## The CSS budget

A theme's CSS may set any **paint** property. The following are forbidden: the
check rejects them on bundled themes and warns on user themes.

- `animation` / `transition` on any property;
- animated custom properties (they run on the main thread);
- `filter` / `backdrop-filter`;
- more than a couple of shadow layers;
- any property that changes layout (`width`, `height`, `padding`, `margin`,
  `font-size`, `display`, `position`, …) — those belong to structural tokens.

## Schema and validation

`src/shared/theme-tokens.js` declares each token once:

```js
{ id: '--radius', label: 'Corner radius', type: 'length',
  kind: 'paint', default: '8px', min: 0, max: 20,
  applies: 'cards, controls and popups' }
```

That one declaration drives four things: the docs table (`npm run theme:docs`),
the test guard (`npm test`), the runtime fallback, and the re-measure set (the
`kind: 'structural'` tokens). `npm run theme:check [file] [--partial]` validates
a theme against the schema. Both are plain Node, no dependency.

`npm test` fails unless: ids are unique; every bundled theme defines every
token; every `var(--x)` in the renderer is a token or a known local; the docs
table matches the manifest; and the structural set matches the declared tokens.

## Changing theme: one re-measure pass

A theme switch is a single IPC and, in each window, one style recalculation.
`kernel/themes.js` compares the new **structural** values against the last ones
and, only if one moved, fires a `theme-structural` event on the next frame. The
module-bearing windows (`app.js`, `float.js`) answer with `board.remeasure()`, and
`Board#remeasure` → `_enforceWindowMin()` grows the window if anything is now
clipped (the board's own `ResizeObserver` on its root covers the same case; the
`_resizeGraceUntil` guard keeps a programmatic resize from fighting it). A
colour-only change skips all of this. At startup the theme is applied before the
first measurement, so the layout already uses its metrics. Cost: one layout read
and at most one clamp per switch, and zero in steady state.

## Stable hooks

A theme's CSS couples to Iroiroppa's markup, so treat these as the contract and
the rest as internal: the `#app` shell; `#titlebar`, `.titlebar`, `.brand`,
`.brand-input`, `.brand-text`, `.title-actions`; the `.module`, `.module-head`,
`.module-body`, `.module-title` card; `.column`; and the control classes
`.slot`, `.swatch`, `.history-chip`, `.btn`, `.icon-btn`, `.mini-btn`,
`.text-input`, `.pop-action`, `.pop-select`, `.rng`. A rename here can break a
theme; `blender-dark.css` is the worked example.

## Token reference

The table is generated from `src/shared/theme-tokens.js` by `npm run theme:docs`; the
test fails if it drifts. `Kind` is the paint/structural split above.

<!-- tokens:start (generated from src/shared/theme-tokens.js) -->
| Token | Kind | Type | Default | Applies to |
| --- | --- | --- | --- | --- |
| `--bg` | paint | color | `#ffffff` | app shell, popups and drop lines |
| `--bg-2` | paint | color | `#ffffff` | slots, plots and other inset surfaces |
| `--bg-3` | paint | color | `#f2f4f9` | buttons, ranges and raised controls |
| `--line` | paint | color | `#e1e5ee` | card outlines, dividers and control borders |
| `--text` | paint | color | `#1b1f2a` | body text |
| `--text-strong` | paint | color | `#22262f` | headings and emphasised text |
| `--text-dim` | paint | color | `#6b7280` | secondary text and icons |
| `--text-faint` | paint | color | `#9aa1b1` | faint labels and placeholders |
| `--hover` | paint | color | `#e9ecf3` | hover background for controls |
| `--bar` | paint | color | `#f7f8fb` | a popout window title bar |
| `--bar-2` | paint | color | `#eef1f8` | hovered menu and popup items |
| `--input-bg` | paint | color | `#ffffff` | text inputs and selects |
| `--titlebar-top` | paint | color | `#ffffff` | the module card head background |
| `--dot-off` | paint | color | `#c3c9d6` | the disconnected status dot |
| `--accent` | paint | color | `#6c5ce7` | selection, focus and the app accent |
| `--accent-weak` | paint | color | `#ece9fd` | the tint behind a selected row |
| `--online` | paint | color | `#22b573` | the connected dot and success states |
| `--busy` | paint | color | `#e8a020` | the busy dot and warning states |
| `--error` | paint | color | `#c62828` | the error dot and destructive actions |
| `--blank` | paint | color | `#ffffff` | an empty slot and the blank canvas |
| `--checker-a` | paint | color | `#d9dde7` | the transparency checkerboard, first colour |
| `--checker-b` | paint | color | `#ffffff` | the transparency checkerboard, second colour |
| `--checker-empty-a` | paint | color | `#e9ebf1` | the empty-slot checkerboard |
| `--shadow` | paint | shadow | `rgba(20, 24, 35, 0.22)` | elevation shadows |
| `--seg-track` | paint | color | `#eceef3` | the segmented-control track |
| `--seg-active` | paint | color | `#ffffff` | the segmented-control active pill |
| `--board` | paint | color | `#f2f4f9` | the board surface behind the cards |
| `--card` | paint | color | `#ffffff` | the module card surface |
| `--radius` | paint | length | `8px` | the shell and popup corners (paint: no reflow) |
| `--font-ui` | structural | font | `"Segoe UI", system-ui, -apple-system, sans-serif` | the UI font family |
| `--mono` | structural | font | `ui-monospace, "Cascadia Mono", Consolas, monospace` | numeric readouts and the hex field |
| `--font-size` | structural | length | `11px` | the base UI text size (a theme shifts labels from it) |
| `--space` | structural | length | `3px` | card padding and the gaps between cards |
<!-- tokens:end -->

## Deferred

Border width, control dimensions (`--slider-thickness`, `--history-tile`,
`--row-height`, `--icon-size`), per-module structural tokens and `--density` are
out of v1: each adds a resize path and a test for little gain. They are written
up in ``, "Theme structural tokens".

'use strict';

// The theming surface: one entry per CSS custom property a theme file may set.
//
// This is the single source of truth for docs/THEMES.md (the table between its
// `tokens` markers is generated from here), for the theme-authoring skill and for
// test/theme-tokens.test.js. Add a token here *first*, then declare it in
// `style.css` (`:root`) and use it; the test fails if a documented token is unused
// or a bundled theme is missing one.
//
// `kind` is the contract that keeps theming cheap and safe:
//   - `paint`     never changes geometry (colour, shadow, radius) — free.
//   - `structural` can change an element's measured size (font size, spacing) —
//     the app re-measures and re-clamps the window when it changes. See
//     docs/THEMES.md, "Two kinds of token".
//
// `default` is the value the renderer falls back to when a (usually user) theme
// omits the token; it mirrors `style.css`'s light `:root`, and the test keeps the
// two in step. Electron-free and dependency-free on purpose, and loadable both in
// Node (require) and in the renderer (a plain <script>).

/** @typedef {{ id: string, label: string, type: 'color'|'shadow'|'font'|'length', kind: 'paint'|'structural', default: string, applies: string, required: boolean, min?: number, max?: number }} ThemeToken */

/** @type {ThemeToken[]} */
const TOKENS = [
  { id: '--bg', label: 'Window background', type: 'color', kind: 'paint', default: '#ffffff', required: true, applies: 'app shell, popups and drop lines' },
  { id: '--bg-2', label: 'Sunken surface', type: 'color', kind: 'paint', default: '#ffffff', required: true, applies: 'slots, plots and other inset surfaces' },
  { id: '--bg-3', label: 'Raised surface', type: 'color', kind: 'paint', default: '#f2f4f9', required: true, applies: 'buttons, ranges and raised controls' },
  { id: '--line', label: 'Borders', type: 'color', kind: 'paint', default: '#e1e5ee', required: true, applies: 'card outlines, dividers and control borders' },
  { id: '--text', label: 'Text', type: 'color', kind: 'paint', default: '#1b1f2a', required: true, applies: 'body text' },
  { id: '--text-strong', label: 'Strong text', type: 'color', kind: 'paint', default: '#22262f', required: true, applies: 'headings and emphasised text' },
  { id: '--text-dim', label: 'Dim text', type: 'color', kind: 'paint', default: '#6b7280', required: true, applies: 'secondary text and icons' },
  { id: '--text-faint', label: 'Faint text', type: 'color', kind: 'paint', default: '#9aa1b1', required: true, applies: 'faint labels and placeholders' },
  { id: '--hover', label: 'Hover', type: 'color', kind: 'paint', default: '#e9ecf3', required: true, applies: 'hover background for controls' },
  { id: '--bar', label: 'Title bar', type: 'color', kind: 'paint', default: '#f7f8fb', required: true, applies: 'a popout window title bar' },
  { id: '--bar-2', label: 'Menu item hover', type: 'color', kind: 'paint', default: '#eef1f8', required: true, applies: 'hovered menu and popup items' },
  { id: '--input-bg', label: 'Input background', type: 'color', kind: 'paint', default: '#ffffff', required: true, applies: 'text inputs and selects' },
  { id: '--titlebar-top', label: 'Card head', type: 'color', kind: 'paint', default: '#ffffff', required: true, applies: 'the module card head background' },
  { id: '--dot-off', label: 'Offline dot', type: 'color', kind: 'paint', default: '#c3c9d6', required: true, applies: 'the disconnected status dot' },
  { id: '--accent', label: 'Accent', type: 'color', kind: 'paint', default: '#6c5ce7', required: true, applies: 'selection, focus and the app accent' },
  { id: '--accent-weak', label: 'Accent tint', type: 'color', kind: 'paint', default: '#ece9fd', required: true, applies: 'the tint behind a selected row' },
  { id: '--online', label: 'Online', type: 'color', kind: 'paint', default: '#22b573', required: true, applies: 'the connected dot and success states' },
  { id: '--busy', label: 'Busy', type: 'color', kind: 'paint', default: '#e8a020', required: true, applies: 'the busy dot and warning states' },
  { id: '--error', label: 'Error', type: 'color', kind: 'paint', default: '#c62828', required: true, applies: 'the error dot and destructive actions' },
  { id: '--blank', label: 'Blank', type: 'color', kind: 'paint', default: '#ffffff', required: true, applies: 'an empty slot and the blank canvas' },
  { id: '--checker-a', label: 'Checker A', type: 'color', kind: 'paint', default: '#d9dde7', required: true, applies: 'the transparency checkerboard, first colour' },
  { id: '--checker-b', label: 'Checker B', type: 'color', kind: 'paint', default: '#ffffff', required: true, applies: 'the transparency checkerboard, second colour' },
  { id: '--checker-empty-a', label: 'Empty checker', type: 'color', kind: 'paint', default: '#e9ebf1', required: true, applies: 'the empty-slot checkerboard' },
  { id: '--shadow', label: 'Shadow', type: 'shadow', kind: 'paint', default: 'rgba(20, 24, 35, 0.22)', required: true, applies: 'elevation shadows' },
  { id: '--seg-track', label: 'Segmented track', type: 'color', kind: 'paint', default: '#eceef3', required: true, applies: 'the segmented-control track' },
  { id: '--seg-active', label: 'Segmented active', type: 'color', kind: 'paint', default: '#ffffff', required: true, applies: 'the segmented-control active pill' },
  { id: '--board', label: 'Board', type: 'color', kind: 'paint', default: '#f2f4f9', required: true, applies: 'the board surface behind the cards' },
  { id: '--card', label: 'Card', type: 'color', kind: 'paint', default: '#ffffff', required: true, applies: 'the module card surface' },
  { id: '--radius', label: 'Corner radius', type: 'length', kind: 'paint', default: '8px', required: true, min: 0, max: 24, applies: 'the shell and popup corners (paint: no reflow)' },
  { id: '--font-ui', label: 'UI font', type: 'font', kind: 'structural', default: '"Segoe UI", system-ui, -apple-system, sans-serif', required: true, applies: 'the UI font family' },
  { id: '--mono', label: 'Monospace font', type: 'font', kind: 'structural', default: 'ui-monospace, "Cascadia Mono", Consolas, monospace', required: true, applies: 'numeric readouts and the hex field' },
  { id: '--font-size', label: 'UI text size', type: 'length', kind: 'structural', default: '11px', required: true, min: 8, max: 18, applies: 'the base UI text size (a theme shifts labels from it)' },
  { id: '--space', label: 'Spacing unit', type: 'length', kind: 'structural', default: '3px', required: true, min: 2, max: 12, applies: 'card padding and the gaps between cards' },
];

// Variables that are never part of a theme file: a value a module sets inline
// (`--slider-pct`, `--history-tile`), a local the stylesheet owns (`--panel`) and
// the accent ink the kernel derives (`--accent-text`). The docs and tests ignore
// them when checking token coverage.
const LOCAL_VARS = ['--panel', '--slider-pct', '--history-tile', '--accent-text'];

const TOKEN_MARK_START = '<!-- tokens:start (generated from src/shared/theme-tokens.js) -->';
const TOKEN_MARK_END = '<!-- tokens:end -->';

/** The color forms a theme value may take (a shadow is any of these, usually rgba). */
const COLOR_RE = /^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;
/** A CSS length: a number with a unit (px/rem/em/%). `calc()` is allowed for lengths. */
const LENGTH_RE = /^(-?\d*\.?\d+(px|rem|em|%|ch|vh|vw)|calc\(.+\))$/i;

function ids() {
  return TOKENS.map((t) => t.id);
}

function get(id) {
  return TOKENS.find((t) => t.id === id) || null;
}

function isColor(value) {
  return typeof value === 'string' && COLOR_RE.test(value.trim());
}

function isLength(value) {
  return typeof value === 'string' && LENGTH_RE.test(value.trim());
}

/** Length in CSS px for a plain px/rem value, else null (used for bounds checks). */
function lengthPx(value) {
  const m = /^(-?\d*\.?\d+)(px|rem)$/i.exec(String(value || '').trim());
  if (!m) return null;
  return parseFloat(m[1]) * (m[2].toLowerCase() === 'rem' ? 16 : 1);
}

/** The structural token ids — the ones whose change triggers a re-measure. */
function structuralIds() {
  return TOKENS.filter((t) => t.kind === 'structural').map((t) => t.id);
}

/** The token table for docs/THEMES.md, between its markers. */
function renderTokenSection() {
  const rows = TOKENS.map((t) => `| \`${t.id}\` | ${t.kind} | ${t.type} | \`${t.default}\` | ${t.applies} |`);
  return [
    '| Token | Kind | Type | Default | Applies to |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

const api = {
  TOKENS,
  LOCAL_VARS,
  TOKEN_MARK_START,
  TOKEN_MARK_END,
  ids,
  get,
  isColor,
  isLength,
  lengthPx,
  structuralIds,
  renderTokenSection,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') {
  window.Iro = window.Iro || {};
  window.Iro.ThemeTokens = api;
}

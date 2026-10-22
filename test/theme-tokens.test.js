'use strict';

// Guards the theme contract: the manifest (src/shared/theme-tokens.js), the
// bundled theme files, the renderer's CSS variables and docs/THEMES.md must all
// agree. This is what makes "vibecoding" a theme safe — a wrong or missing token
// fails here instead of silently rendering.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const T = require('../src/shared/theme-tokens');
const { validateTheme, validateThemeCss } = require('../src/shared/theme-validate');

const ROOT = path.join(__dirname, '..');
const THEME_DIR = path.join(ROOT, 'src', 'renderer', 'themes');
const DOC = path.join(ROOT, 'docs', 'THEMES.md');
const LIGHT = require('../src/renderer/themes/default-light.json');

function bundledThemes() {
  return fs.readdirSync(THEME_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, theme: JSON.parse(fs.readFileSync(path.join(THEME_DIR, f), 'utf8')) }));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(css|html|js)$/i.test(entry.name)) out.push(p);
  }
  return out;
}

function usedVars() {
  const used = new Set();
  for (const file of walk(path.join(ROOT, 'src', 'renderer'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]);
  }
  return used;
}

test('the token manifest has unique, well-formed ids', () => {
  const ids = T.ids();
  assert.ok(ids.length >= 20, 'the manifest looks empty');
  assert.equal(new Set(ids).size, ids.length, 'a duplicate token id');
  for (const t of T.TOKENS) {
    assert.match(t.id, /^--[a-z0-9-]+$/, t.id + ' is not a CSS custom property');
    assert.ok(t.label && t.applies, t.id + ' needs a label and an applies note');
    assert.ok(['color', 'shadow', 'font', 'length'].includes(t.type), t.id + ' has a bad type');
    assert.ok(t.kind === 'paint' || t.kind === 'structural', t.id + ' needs a kind');
    if (t.type === 'font') assert.ok(typeof t.default === 'string' && t.default.trim(), t.id + ' needs a font default');
    else if (t.type === 'length') assert.ok(T.isLength(t.default), t.id + ' needs a length default');
    else assert.ok(T.isColor(t.default), t.id + ' has a default that is not a colour');
  }
});

test('each manifest default matches the light theme', () => {
  for (const t of T.TOKENS) {
    assert.equal(LIGHT.tokens[t.id], t.default, t.id + ' drifted from default-light.json');
  }
});

test('every bundled theme is complete and valid', () => {
  const themes = bundledThemes();
  assert.ok(themes.length >= 2, 'no bundled themes found');
  for (const { file, theme } of themes) {
    const { errors, warnings } = validateTheme(theme);
    assert.deepEqual(errors, [], file + ': ' + errors.join('; '));
    assert.deepEqual(warnings, [], file + ': ' + warnings.join('; '));
  }
});

test('every manifest token is used in the renderer CSS', () => {
  const used = usedVars();
  for (const id of T.ids()) {
    assert.ok(used.has(id), id + ' is documented but never used (drop it or use it)');
  }
});

test('every renderer CSS variable is a theme token or a known local one', () => {
  const known = new Set(T.ids().concat(T.LOCAL_VARS));
  for (const id of usedVars()) {
    assert.ok(known.has(id), id + ' is used in the renderer but not in theme-tokens.js');
  }
});

test('docs/THEMES.md carries the generated token table', () => {
  const text = fs.readFileSync(DOC, 'utf8');
  const start = text.indexOf(T.TOKEN_MARK_START);
  const end = text.indexOf(T.TOKEN_MARK_END);
  assert.ok(start >= 0 && end > start, 'docs/THEMES.md is missing its tokens markers');
  const inFile = text.slice(start + T.TOKEN_MARK_START.length, end).trim();
  assert.equal(inFile, T.renderTokenSection(), 'docs/THEMES.md is stale; run `npm run theme:docs`');
});

test('every bundled theme CSS stays inside the budget', () => {
  for (const { file, theme } of bundledThemes()) {
    const cssFile = path.join(THEME_DIR, file.replace(/\.json$/i, '.css'));
    if (!fs.existsSync(cssFile)) continue;
    const { errors } = validateThemeCss(fs.readFileSync(cssFile, 'utf8'), { strict: true });
    assert.deepEqual(errors, [], file.replace(/\.json$/i, '.css') + ': ' + errors.join('; '));
  }
});
test('the structural set is exactly the size-affecting tokens', () => {
  assert.deepEqual(T.structuralIds().sort(), ['--font-size', '--font-ui', '--mono', '--space']);
});

test('a structural length outside its bounds warns but does not fail', () => {
  const theme = JSON.parse(JSON.stringify(LIGHT));
  theme.tokens['--font-size'] = '30px';
  const { errors, warnings } = validateTheme(theme);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('--font-size')), 'expected a bounds warning');
});

test('the CSS budget flags per-frame and layout properties', () => {
  const strict = validateThemeCss('a { animation: x 1s; padding: 4px; border-radius: 4px; }', { strict: true });
  assert.equal(strict.errors.length, 2, strict.errors.join('; '));
  const soft = validateThemeCss('a { animation: x 1s; }', { strict: false });
  assert.deepEqual(soft.errors, []);
  assert.equal(soft.warnings.length, 1);
});

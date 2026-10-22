'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createThemeStore, readThemeDir, normalizeTheme } = require('../src/main/theme-store');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iroiroppa-themes-'));
  return { dir, store: createThemeStore(dir) };
}

test('readThemeDir reads valid themes and skips malformed ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iroiroppa-themedir-'));
  try {
    fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify({ id: 'mine', name: 'Mine', tokens: { '--bg': '#fff' } }));
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ not json');
    fs.writeFileSync(path.join(dir, 'incomplete.json'), JSON.stringify({ name: 'No id' }));
    fs.writeFileSync(path.join(dir, 'ignored.txt'), 'x');
    const themes = readThemeDir(dir, 'user');
    assert.equal(themes.length, 1);
    assert.deepEqual(themes[0], { id: 'mine', name: 'Mine', dark: false, tokens: { '--bg': '#fff' }, css: '', source: 'user' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizeTheme maps the legacy ids and defaults', () => {
  assert.equal(normalizeTheme('light'), 'default-light');
  assert.equal(normalizeTheme('dark'), 'default-dark');
  assert.equal(normalizeTheme(''), 'default-light');
  assert.equal(normalizeTheme(undefined), 'default-light');
  assert.equal(normalizeTheme('custom'), 'custom');
});

test('listThemes includes the bundled themes and lets a user theme win', () => {
  const { dir, store } = tempStore();
  try {
    const bundled = store.listThemes();
    assert.ok(bundled.some((t) => t.id === 'default-light'), 'default-light is bundled');
    assert.ok(bundled.some((t) => t.id === 'default-dark'), 'default-dark is bundled');

    fs.mkdirSync(path.join(dir, 'themes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'themes', 'default-light.json'), JSON.stringify({
      id: 'default-light', name: 'Overridden', tokens: { '--bg': '#010203' },
    }));
    const merged = store.listThemes();
    const light = merged.find((t) => t.id === 'default-light');
    assert.equal(light.name, 'Overridden');
    assert.equal(light.source, 'user');
    assert.equal(store.themeBackground('default-light'), '#010203');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a theme carries its sibling CSS and its per-theme assets', () => {
  const { dir, store } = tempStore();
  try {
    const themes = path.join(dir, 'themes');
    fs.mkdirSync(path.join(themes, 'mine'), { recursive: true });
    fs.writeFileSync(path.join(themes, 'mine.json'), JSON.stringify({ id: 'mine', name: 'Mine', tokens: { '--bg': '#000' } }));
    fs.writeFileSync(path.join(themes, 'mine.css'), ':root { --radius: 2px; }');
    fs.writeFileSync(path.join(themes, 'mine', 'font.woff2'), 'x');
    fs.writeFileSync(path.join(dir, 'outside.woff2'), 'x');

    const theme = store.listThemes().find((t) => t.id === 'mine');
    assert.equal(theme.css, ':root { --radius: 2px; }');
    assert.ok(store.themeAssetPath('mine', 'font.woff2'), 'the per-theme asset resolves');
    assert.equal(store.themeAssetPath('mine', '../outside.woff2'), '', 'traversal is refused');
    assert.equal(store.themeAssetPath('mine', 'missing.woff2'), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a user theme with no CSS inherits the bundled CSS', () => {
  const { dir, store } = tempStore();
  try {
    fs.mkdirSync(path.join(dir, 'themes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'themes', 'blender-dark.json'), JSON.stringify({
      id: 'blender-dark', name: 'Blender Dark+', tokens: { '--bg': '#101010' },
    }));
    const theme = store.listThemes().find((t) => t.id === 'blender-dark');
    assert.equal(theme.name, 'Blender Dark+');
    assert.ok(theme.css && theme.css.length > 0, 'the bundled blender-dark.css carried over');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
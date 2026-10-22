'use strict';

// Theme files: bundled JSON (and optional CSS) beside the renderer, plus user
// themes in the app-data `themes/` folder (a user theme overrides a bundled one
// of the same id).
//
// A theme is `<id>.json` (tokens) plus an optional sibling `<id>.css` (arbitrary
// overrides, injected after the base stylesheets). Per-theme assets (fonts,
// images) live in a folder named after the id, `<themesDir>/<id>/...`, and reach
// the renderer over the `theme://` protocol via themeAssetPath().
//
// Electron-free except for the injected app-data directory.

const fs = require('node:fs');
const path = require('node:path');

const THEME_DIR = path.join(__dirname, '..', 'renderer', 'themes');
// Values written before themes became files; migrated on load.
const THEME_ALIASES = { light: 'default-light', dark: 'default-dark' };

/** The optional sibling CSS for a theme JSON, or ''. */
function readThemeCss(file) {
  try { return fs.readFileSync(file.replace(/\.json$/i, '.css'), 'utf8'); } catch { return ''; }
}

/** Read every valid *.json theme in a folder. */
function readThemeDir(dir, source) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!/\.json$/i.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!raw || typeof raw !== 'object' || !raw.id || !raw.tokens) continue;
      out.push({
        id: String(raw.id),
        name: String(raw.name || raw.id),
        dark: Boolean(raw.dark),
        tokens: raw.tokens,
        css: readThemeCss(file),
        source,
      });
    } catch (err) {
      console.warn(`theme "${name}" skipped:`, err.message);
    }
  }
  return out;
}

function normalizeTheme(id) {
  return THEME_ALIASES[id] || id || 'default-light';
}

/** @param {string|(() => string)} userData the app-data directory, or a getter */
function createThemeStore(userData) {
  const dir = () => (typeof userData === 'function' ? userData() : userData);

  /** Bundled themes, with user themes in app-data overriding same-id ones. */
  function listThemes() {
    const byId = new Map();
    for (const t of readThemeDir(THEME_DIR, 'bundled')) byId.set(t.id, t);
    for (const t of readThemeDir(path.join(dir(), 'themes'), 'user')) {
      const prior = byId.get(t.id);
      // A user theme that brings no CSS inherits the bundled one, so recolouring a
      // bundled theme does not silently drop its layout overrides.
      if (prior && prior.css && !t.css) t.css = prior.css;
      byId.set(t.id, t);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The settings window's OS background follows the active theme's background. */
  function themeBackground(id) {
    const theme = listThemes().find((t) => t.id === normalizeTheme(id));
    const bg = theme && theme.tokens && theme.tokens['--bg'];
    return typeof bg === 'string' && bg.startsWith('#') ? bg : '#f2f4f9';
  }

  /**
   * Resolve a `theme://<id>/<rel>` asset to a file on disk, or '' when it is
   * missing or would escape the theme folder. Per-id assets live in
   * `<themesDir>/<id>/`; a user theme wins over a bundled one.
   */
  function themeAssetPath(id, rel) {
    const parts = String(rel || '').split(/[\\/]+/).filter(Boolean);
    if (!id || !parts.length || parts.some((p) => p === '..' || p === '.')) return '';
    const roots = [path.join(dir(), 'themes', id), path.join(THEME_DIR, id)];
    for (const root of roots) {
      const file = path.join(root, ...parts);
      if (!file.startsWith(root + path.sep)) continue;
      try { if (fs.statSync(file).isFile()) return file; } catch { /* try the next root */ }
    }
    return '';
  }

  return { readThemeDir, listThemes, normalizeTheme, themeBackground, themeAssetPath };
}

module.exports = { createThemeStore, readThemeDir, normalizeTheme, THEME_DIR };
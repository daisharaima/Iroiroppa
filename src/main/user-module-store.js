'use strict';

// User modules (docs/USER-MODULES.md): a folder under
// `%APPDATA%\Iroiroppa\user-modules\<id>\` holding `module.js` (the module, a
// classic script that registers itself like a bundled one) and an optional
// `module.json` (its metadata). Main reads the folder and serves the script over
// `module://<id>/module.js`; this store is the only thing that reads the
// directory, so the renderer and the protocol agree on what is valid.
//
// Note the directory is `user-modules`, deliberately NOT `modules` — that one
// holds per-instance settings JSON (module-store.js).

const fs = require('node:fs');
const path = require('node:path');
const ModuleManifest = require('../shared/module-manifest');

const ID_RE = /^[a-z0-9_-]+$/i;
const GROUPS = ['core', 'picker', 'utility'];

function createUserModuleStore(userData, { modulesDir: modulesDirFn } = {}) {
  const dir = () => (typeof userData === 'function' ? userData() : userData);
  // `userData` is the app-data root (so the folder is `<root>/user-modules`); an
  // explicit `modulesDir` overrides it (the `--user-module <dir>` fixture).
  const modulesDir = modulesDirFn || (() => path.join(dir(), 'user-modules'));

  /** One validated entry from a `user-modules/<id>/` folder, or null. */
  function readOne(base, id) {
    if (!ID_RE.test(id) || ModuleManifest.has(id)) return null; // bundled ids win
    const folder = path.join(base, id);
    if (!fs.existsSync(path.join(folder, 'module.js'))) return null;
    const metaFile = path.join(folder, 'module.json');
    let meta = {};
    if (fs.existsSync(metaFile)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) || {};
      } catch {
        // A malformed manifest is refused rather than half-loaded; the folder is
        // skipped and the reason said once, so a typo does not load a broken module.
        console.warn(`[user-modules] "${id}" has a malformed module.json — skipping`);
        return null;
      }
    }
    return {
      id,
      name: String(meta.name || id),
      autoHeight: meta.autoHeight === true,
      instanceable: meta.instanceable !== false,
      group: GROUPS.includes(meta.group) ? meta.group : 'utility',
      defaultRatio: Number.isFinite(meta.defaultRatio) && meta.defaultRatio > 0 ? meta.defaultRatio : null,
    };
  }

  /** Every valid user module, sorted by id. Never throws. */
  function list() {
    const base = modulesDir();
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return []; }
    const out = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const mod = readOne(base, ent.name);
      if (mod) out.push(mod);
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  /**
   * Resolve `module://<id>/<rel>` to a file under the user module's folder, or ''
   * when the id is bundled/unknown or the path escapes the folder (mirrors
   * theme-store.js#themeAssetPath).
   */
  function assetPath(id, rel) {
    const folder = path.join(modulesDir(), String(id || ''));
    if (!ID_RE.test(String(id || '')) || ModuleManifest.has(id)) return '';
    const base = path.resolve(folder);
    const target = path.resolve(base, String(rel || ''));
    if (!target.startsWith(base + path.sep)) return '';
    return fs.existsSync(target) ? target : '';
  }

  return { list, assetPath };
}

module.exports = { createUserModuleStore, ID_RE };

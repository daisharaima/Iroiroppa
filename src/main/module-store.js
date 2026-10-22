'use strict';

// Per-module settings, one file per module id (`modules/<id>.json`). The list of
// module ids comes from the shared module manifest
// (src/shared/module-manifest.js). Electron-free — the caller injects the
// app-data directory — so it is testable headlessly.

const fs = require('node:fs');
const path = require('node:path');
const ModuleManifest = require('../shared/module-manifest');
const { LEGACY_MODULE_IDS } = require('../shared/layout-model');

const MODULE_ID_RE = /^[a-z0-9_-]+$/i;

/** The old id a renamed module's settings file might still use, if any. */
const legacyIdFor = (id) => Object.keys(LEGACY_MODULE_IDS).find((old) => LEGACY_MODULE_IDS[old] === id) || null;

/** Unused settings files older than this are swept at startup (the Trash section shows the rest). */
const TRASH_DAYS = 30;

/** @param {string|(() => string)} userData the app-data directory, or a getter */
function createModuleStore(userData) {
  const dir = () => (typeof userData === 'function' ? userData() : userData);
  const moduleSettingsFile = (id) => path.join(dir(), 'modules', `${id}.json`);

  /** The module ids shipped with the app (used by the Modules tab). The list is
   *  the shared manifest, not a scan of the disk, so it has one home and works
   *  even when a module's file is missing. */
  function listModuleIds() {
    return ModuleManifest.ids();
  }

  /** Copy one instance's settings file onto another instance id (duplicate): a new
   *  instance starts from the settings of the one it was made from, then diverges. */
  function copySettings(fromId, toId, moduleId) {
    if (!MODULE_ID_RE.test(String(fromId || '')) || !MODULE_ID_RE.test(String(toId || ''))) return false;
    const from = readSettingsFile(fromId);
    if (from == null) return false; // the source has no file of its own to copy
    try {
      fs.mkdirSync(path.dirname(moduleSettingsFile(toId)), { recursive: true });
      const body = { settings: from };
      if (moduleId && MODULE_ID_RE.test(String(moduleId))) body.moduleId = moduleId;
      fs.writeFileSync(moduleSettingsFile(toId), JSON.stringify(body, null, 2));
    } catch {
      return false;
    }
    return true;
  }

  /**
   * Read stored settings: `null` when there is no file (so a caller may fall back),
   * `{}` when the file is there but unreadable (never fall back — mixing two sources
   * silently is worse than running on the module's defaults).
   * @param {string} id an instance id (post-N1) or a module id
   */
  function readSettingsFile(id) {
    if (!MODULE_ID_RE.test(String(id || ''))) return null;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(moduleSettingsFile(id), 'utf8'));
    } catch (err) {
      return err && err.code === 'ENOENT' ? null : {};
    }
    return raw && raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  }

  /**
   * Read a module's stored settings ({} when absent or malformed).
   *
   * `id` is the *instance* now (docs/LAYOUT.md, N1) and `fallbackId` the module id,
   * so an instance with no file of its own inherits the module's settings — which is
   * exactly how every pre-N1 setting carries over to the first instance.
   */
  function readModuleSettings(id, fallbackId) {
    const own = readSettingsFile(id);
    if (own !== null) return own;
    if (fallbackId && fallbackId !== id) {
      const fallback = readSettingsFile(fallbackId);
      if (fallback !== null) return fallback;
      // A module id renamed in Oct 2026: inherit the settings under the old id.
      const legacy = legacyIdFor(fallbackId);
      if (legacy) {
        const old = readSettingsFile(legacy);
        if (old !== null) return old;
      }
    }
    return {};
  }

  /** Write a module's settings — one file per module id, so a module update or
   * removal never destroys the user's settings for another. `moduleId` is recorded
   * so a deleted instance's file in the Trash can be restored to the right module. */
  function writeModuleSettings(id, settings, version, moduleId) {
    if (!MODULE_ID_RE.test(String(id || ''))) return false;
    try {
      const file = moduleSettingsFile(id);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const body = {
        version: Number(version) || 1,
        settings: settings && typeof settings === 'object' ? settings : {},
      };
      if (moduleId && MODULE_ID_RE.test(String(moduleId))) body.moduleId = moduleId;
      // Temp file then rename: a crash mid-write must not leave a truncated file,
      // which a reader takes for "no settings" and silently resets the module.
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8');
      fs.renameSync(tmp, file);
      return true;
    } catch (err) {
      console.warn(`could not save module "${id}" settings:`, err.message);
      return false;
    }
  }

  /**
   * The whole settings file, `{ version, moduleId?, settings }`, for the Trash's
   * preview and its restore (the module id is what makes a restore possible).
   * `null` when the file is missing or malformed.
   */
  function readSettingsFileFull(id) {
    if (!MODULE_ID_RE.test(String(id || ''))) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(moduleSettingsFile(id), 'utf8'));
      return raw && typeof raw === 'object' ? raw : null;
    } catch {
      return null;
    }
  }

  /** Remove one settings file by id (a restore has consumed it). */
  function removeSettingsFile(id) {
    if (!MODULE_ID_RE.test(String(id || ''))) return false;
    try { fs.unlinkSync(moduleSettingsFile(id)); return true; } catch { return false; }
  }

  /**
   * Settings files nothing uses any more: a `modules/<id>.json` whose id is neither a module in
   * the manifest nor an instance of the workspace (placed *or* hidden — hiding an instance is
   * exactly what keeps its settings). Deleting a palette or an instance keeps its file so a
   * mis-click is recoverable, and main sweeps the ones older than `TRASH_DAYS` by itself.
   *
   * @param {string[]} keepIds instance ids the workspace still uses
   * @param {number} now for `ageDays`, so a test can age a file without touching the clock
   */
  function listUnused(keepIds = [], now = Date.now()) {
    const keep = new Set([...ModuleManifest.ids(), ...(keepIds || [])].map(String));
    let names = [];
    try {
      names = fs.readdirSync(path.join(dir(), 'modules'));
    } catch {
      return []; // no folder yet: nothing to sweep
    }
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      if (!MODULE_ID_RE.test(id) || keep.has(id)) continue;
      const file = moduleSettingsFile(id);
      try {
        const stat = fs.statSync(file);
        out.push({ id, file, mtime: stat.mtimeMs, ageDays: Math.floor((now - stat.mtimeMs) / 86400000) });
      } catch { /* vanished between readdir and stat */ }
    }
    return out.sort((a, b) => a.mtime - b.mtime);
  }

  /**
   * Delete unused settings files. `olderThanDays` 0 (the default) removes all of them — that is
   * what the Trash section's button does; the startup sweep passes `TRASH_DAYS`.
   * @returns {string[]} the instance ids whose files went
   */
  function purgeUnused(keepIds = [], now = Date.now(), olderThanDays = 0) {
    const victims = listUnused(keepIds, now).filter((f) => f.ageDays >= Number(olderThanDays || 0));
    const removed = [];
    for (const f of victims) {
      try {
        fs.unlinkSync(f.file);
        removed.push(f.id);
      } catch { /* leave a file we cannot delete */ }
    }
    return removed;
  }

  return { listModuleIds, moduleSettingsFile, readModuleSettings, writeModuleSettings, listUnused, purgeUnused, copySettings, readSettingsFileFull, removeSettingsFile };
}

module.exports = { createModuleStore, MODULE_ID_RE, TRASH_DAYS };

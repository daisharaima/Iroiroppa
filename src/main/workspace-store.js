'use strict';

// Named saved workspaces (Settings → Layout).
//
// A workspace is a *snapshot of the whole layout document*, the same shape
// `workspace:export` writes and `workspace:import` accepts. Main owns this store
// (one writer) exactly as it owns layout.json; the renderer only asks it to save,
// load, rename and delete. Each workspace is one file under
// `%APPDATA%\Iroiroppa\workspaces\<id>.json`, written atomically.
//
// Electron-free, so it is unit-tested headlessly.

const fs = require('node:fs');
const path = require('node:path');
const { readJsonFile, writeJsonAtomic } = require('./json-file');

const VERSION = 1;
const KIND = 'iroiroppa-workspace';

/** Strip a workspace document down to the list metadata. */
const meta = (w) => ({ id: w.id, name: w.name, savedAt: w.savedAt || 0 });

function createWorkspaceStore(getDir, { now = Date.now } = {}) {
  const dir = () => path.join(getDir(), 'workspaces');
  const file = (id) => path.join(dir(), `${id}.json`);

  function ensure() {
    fs.mkdirSync(dir(), { recursive: true });
  }

  /** Every saved workspace, newest first. A malformed file is skipped, not fatal. */
  function list() {
    ensure();
    const out = [];
    for (const name of fs.readdirSync(dir())) {
      if (!name.endsWith('.json')) continue;
      const w = readJsonFile(path.join(dir(), name));
      if (w && w.id && w.doc) out.push(meta(w));
    }
    return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  function get(id) {
    if (!id) return null;
    const w = readJsonFile(file(id));
    return w && w.id && w.doc ? w : null;
  }

  /** Save the current document under `name`; a same-named workspace is overwritten. */
  function save(name, doc) {
    if (!doc) return { ok: false, error: 'no-document' };
    ensure();
    const clean = String(name || '').trim() || 'Workspace';
    const existing = list().find((m) => m.name.toLowerCase() === clean.toLowerCase());
    const id = existing ? existing.id : `w-${now()}-${Math.random().toString(36).slice(2, 8)}`;
    const w = { kind: KIND, version: VERSION, id, name: clean, savedAt: now(), doc };
    writeJsonAtomic(file(id), w);
    return { ok: true, workspace: meta(w) };
  }

  function rename(id, name) {
    const w = get(id);
    if (!w) return { ok: false, error: 'unknown-workspace' };
    const clean = String(name || '').trim();
    if (clean) w.name = clean;
    writeJsonAtomic(file(id), w);
    return { ok: true, workspace: meta(w) };
  }

  function remove(id) {
    if (!id) return { ok: false, error: 'unknown-workspace' };
    try {
      fs.rmSync(file(id), { force: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return { list, get, save, rename, remove, dir: dir() };
}

module.exports = { createWorkspaceStore, VERSION, KIND };

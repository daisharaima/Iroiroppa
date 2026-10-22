'use strict';

// layout.json, schema v2: the workspace document (a list of palettes).
//
// Electron-free — the caller injects the app-data directory — so the v1 -> v2
// migration and the read/write round-trip are testable headlessly. The only
// writer is `layout-service.js`, which holds the document in memory and calls
// `write` on a short debounce (see docs/LAYOUT.md).
//
// v1 was `{ columns, floats }` with the palette's placement in settings.json and
// a module `weight` (null = the module's own default). A v1 weight maps
// losslessly onto the new height model: a stored weight is a `fill` share, and a
// null weight is `auto` for a module that declares `autoHeight` (the registry
// says which) and otherwise v1's default share.

const fs = require('node:fs');
const path = require('node:path');
const Model = require('../shared/layout-model');
const View = require('./layout-view');
const { readJsonFile, writeJsonAtomic, backupFile: backupCorruptFile } = require('./json-file');

const SNAP_EDGES = Model.SNAP_EDGES;
const DEFAULT_FLOAT_SIZE = 260;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** v1 stored a module's share as `weight`; `height` is the same key under an
 *  older name (the first-run default in app.js used it), and a locked-ratio module
 *  stored `ratio` instead. The mapping itself lives in layout-view.js, shared with
 *  the v1 write path, so there is one of it — and it must go through
 *  `heightEntryFromV1`, or a v1 `ratio` is silently dropped and every locked-ratio
 *  module migrates to its default height. */
function v1Height(raw, registry) {
  return View.heightEntryFromV1(raw, undefined, registry, raw && raw.moduleId);
}

function v1Columns(columns, registry, prefix) {
  return (Array.isArray(columns) ? columns : [])
    .filter((c) => c && typeof c === 'object')
    .map((column, i) => ({
      id: column.id != null ? String(column.id) : `${prefix}c${i + 1}`,
      width: finite(column.width) > 0 ? column.width : null,
      modules: (Array.isArray(column.modules) ? column.modules : [])
        .filter((m) => m && m.moduleId)
        .map((m, j) => ({
          instanceId: m.instanceId != null ? String(m.instanceId) : `${prefix}m${i + 1}_${j + 1}`,
          moduleId: String(m.moduleId),
          height: v1Height(m, registry),
        })),
    }));
}

/** The palette's placement used to live in settings.json. `windowBounds` is the
 *  current shape (`x`/`y` in DIP, `width`/`height` in CSS px); `windowPos` /
 *  `windowSize` are the older keys, read once. */
function primaryPlacement(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const bounds = s.windowBounds && typeof s.windowBounds === 'object' ? s.windowBounds : null;
  if (bounds) {
    return {
      pos: {
        x: finite(bounds.x),
        y: finite(bounds.y),
        displayId: bounds.displayId != null ? bounds.displayId : null,
      },
      size: { width: finite(bounds.width), height: finite(bounds.height) },
    };
  }
  const pos = s.windowPos && typeof s.windowPos === 'object' ? s.windowPos : {};
  const size = s.windowSize && typeof s.windowSize === 'object' ? s.windowSize : {};
  return {
    pos: { x: finite(pos.x), y: finite(pos.y), displayId: null },
    size: { width: finite(size.width), height: finite(size.height) },
  };
}

/**
 * v1 -> v2. The palette keeps its columns and its saved placement; each float
 * becomes a palette (with the palette as its snap anchor); names are assigned by
 * document order.
 * @param {object} rawV1 the `{ columns, floats }` document
 * @param {object} settingsV1 settings.json (for the palette's placement)
 * @param {{registry?: object}} [opts] the module registry, for `autoHeight`
 */
function migrateV1(rawV1, settingsV1, opts) {
  const registry = (opts && opts.registry) || null;
  const src = rawV1 && typeof rawV1 === 'object' ? rawV1 : {};
  const placement = primaryPlacement(settingsV1);
  const palettes = [{
    id: 'p1',
    name: 'Palette 1',
    pos: placement.pos,
    size: placement.size,
    collapsed: false,
    snap: null,
    snapTo: null,
    columns: v1Columns(src.columns, registry, 'p1'),
  }];

  const floats = Array.isArray(src.floats) ? src.floats : [];
  floats.forEach((f, i) => {
    if (!f || typeof f !== 'object') return;
    const floatId = f.floatId != null ? String(f.floatId) : `f${i + 1}`;
    // Before float boards existed a float held one module; keep that path.
    const columns = Array.isArray(f.columns) && f.columns.length
      ? v1Columns(f.columns, registry, floatId)
      : (f.moduleId
        ? v1Columns([{ id: `${floatId}c1`, width: null, modules: [{ instanceId: f.instanceId, moduleId: f.moduleId, weight: null }] }], registry, floatId)
        : []);
    const snap = SNAP_EDGES.includes(f.snap) ? f.snap : null;
    palettes.push({
      id: floatId,
      name: `Palette ${i + 2}`,
      pos: { x: finite(f.x), y: finite(f.y), displayId: null },
      size: { width: finite(f.width) || DEFAULT_FLOAT_SIZE, height: finite(f.height) || DEFAULT_FLOAT_SIZE },
      collapsed: false,
      snap,
      snapTo: snap ? 'p1' : null,
      columns,
    });
  });

  return Model.normalise({ version: 2, palettes, nextPaletteNumber: palettes.length + 1 }, { registry });
}

/**
 * @param {string|(() => string)} userData the app-data directory, or a getter
 * @param {{registry?: object, readSettings?: () => object}} [options]
 */
function createLayoutStore(userData, options) {
  const opts = options || {};
  const registry = opts.registry || null;
  const dir = () => (typeof userData === 'function' ? userData() : userData);
  const layoutFile = () => path.join(dir(), 'layout.json');
  const backupFile = () => path.join(dir(), 'layout.json.bak');
  const settingsFile = () => path.join(dir(), 'settings.json');
  const readSettings = typeof opts.readSettings === 'function' ? opts.readSettings : () => readJsonFile(settingsFile());

  /** Keep a corrupt document instead of letting the first write destroy it. */
  function backup() {
    return backupCorruptFile(layoutFile());
  }

  function read() {
    const file = layoutFile();
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err && err.code !== 'ENOENT') backup();
      return null;
    }
    if (!raw || typeof raw !== 'object') return null;
    if (Array.isArray(raw.palettes)) {
      const doc = Model.normalise(raw, { registry });
      return doc.palettes.length ? doc : null;
    }
    if (Array.isArray(raw.columns) || Array.isArray(raw.floats)) {
      return migrateV1(raw, readSettings(), { registry });
    }
    return null;
  }

  function write(doc) {
    const clean = Model.normalise(doc, { registry });
    if (!clean.palettes.length) return false;
    try {
      writeJsonAtomic(layoutFile(), clean);
      return true;
    } catch (err) {
      console.warn('could not save layout:', err.message);
      return false;
    }
  }

  return { layoutFile, backupFile, read, write, migrateV1, normalise: (doc) => Model.normalise(doc, { registry }) };
}

module.exports = { createLayoutStore, migrateV1, writeJsonAtomic };

/*
 * The Iroiroppa workspace document and its reducer.
 *
 * One document, one writer: the main process owns the workspace and is the only
 * process that persists it. Renderers send *intents*; `reduce` is pure and
 * returns the next document plus the `effects` the window layer must apply
 * (open / close / fit), so every structural rule is testable with no Electron
 * and no display.
 *
 * The document is schema v2: a list of palettes. There is no main window / sub
 * window split — a float is just another palette. See docs/LAYOUT.md.
 *
 * Loads as CommonJS in Node and as a global `IroLayoutModel` in the renderer, so
 * the board and main share one implementation of the rules.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroLayoutModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 2;
  const SNAP_EDGES = ['left', 'right', 'top', 'bottom'];
  const DEFAULT_WEIGHT = 17; // v1's DEFAULT_WEIGHT, kept for the migration
const DEFAULT_COLUMN_WIDTH = 260;
const DEFAULT_PALETTE_SIZE = { width: 300, height: 640 };
const MAX_NAME = 60;
// A module's height is its column width times its locked ratio (docs/LAYOUT.md,
// "Locked-ratio sizing"). The bounds keep a stored value sane.
const RATIO_MIN = 0.05;
const RATIO_MAX = 4;
const clampRatio = (r) => Math.min(RATIO_MAX, Math.max(RATIO_MIN, r));

/**
 * A module edge drag: the pointer's height (px) over the card's width. This is
 * the same ratio the Module Size slider sets; the drag is capped at the
 * slider's 2.5 so the stored value and the UI can never disagree.
 */
function ratioFromDrag(height, width, minHeight = 24) {
  const w = Number(width);
  if (!(w > 0)) return null;
  const h = Math.max(Number(minHeight) || 0, Number(height) || 0);
  return clampRatio(Math.min(2.5, h / w));
}

  // --- small helpers --------------------------------------------------------

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function str(value, fallback) {
    return typeof value === 'string' && value.length ? value : fallback;
  }

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /** Short, readable ids (`p_2f9c1`). Main generates them; a stray collision is
   *  repaired by `normalise`, and `newId` can be injected for deterministic
   *  tests. */
  function idFactory(rand) {
    const random = typeof rand === 'function' ? rand : Math.random;
    let counter = 0;
    return function newId(prefix) {
      counter += 1;
      const a = Math.floor(random() * 0x100000).toString(36).padStart(4, '0');
      return `${prefix}_${a}${counter.toString(36)}`;
    };
  }

  function envOf(opts) {
    const o = opts || {};
    return {
      registry: o.registry || null,
      newId: o.newId || idFactory(),
      defaultSize: o.defaultSize || DEFAULT_PALETTE_SIZE,
      defaultColumnWidth: o.defaultColumnWidth || DEFAULT_COLUMN_WIDTH,
    };
  }

  function fail(error, doc) {
    return { ok: false, error, doc, effects: [] };
  }

  // --- normalise ------------------------------------------------------------

  function uniqueId(raw, prefix, env, used) {
    let id = str(raw, null);
    if (!id || used.has(id)) id = env.newId(prefix);
    used.add(id);
    return id;
  }

  /**
   * A stored module height. `auto` follows the module's measured content, `px` is
   * explicit, `fill` absorbs leftover space (shared by `weight`), and `ratio` locks
   * the module's height to its column width (docs/LAYOUT.md, "Locked-ratio sizing").
   * An explicit mode always wins, so resizing an `autoHeight` module sticks.
   */
  function normaliseHeight(raw, env, moduleId) {
    const def = env.registry ? env.registry[moduleId] : null;
    if (raw && raw.mode === 'ratio') {
      const ratio = finite(raw.ratio);
      if (ratio && ratio > 0) return { mode: 'ratio', ratio: clampRatio(ratio) };
      // Fall through to the default when a ratio is missing or nonsense.
    }
    if (raw && raw.mode === 'fill') {
      // A fill height predates the locked-ratio model: a module that declares a
      // default ratio adopts it, so an old board converges on the new model.
      if (def && def.defaultRatio) return { mode: 'ratio', ratio: clampRatio(def.defaultRatio) };
      const weight = finite(raw.weight);
      return { mode: 'fill', weight: weight && weight > 0 ? weight : DEFAULT_WEIGHT };
    }
    if (raw && raw.mode === 'px') {
      const px = finite(raw.px);
      if (px && px > 0) return { mode: 'px', px };
      return { mode: 'auto' };
    }
    if (raw && raw.mode === 'auto') return { mode: 'auto' };
    // Nothing stored: the module's own default (a locked ratio where it declares
    // one, its content size when `autoHeight`, otherwise a fluid share).
    if (def && def.defaultRatio) return { mode: 'ratio', ratio: clampRatio(def.defaultRatio) };
    return def && def.autoHeight ? { mode: 'auto' } : { mode: 'fill', weight: DEFAULT_WEIGHT };
  }

  // Module ids renamed in Oct 2026 (a model no longer names a module): a stored
  // document still referring to the old id maps to the new one on read.
  const LEGACY_MODULE_IDS = { 'oklch-slice': 'color-slices', 'oklch-slider': 'color-slider' };
  const canonicalModuleId = (id) => (id && LEGACY_MODULE_IDS[id]) || id;

  function normaliseColumn(raw, env, used) {
    const modules = [];
    const list = raw && Array.isArray(raw.modules) ? raw.modules : [];
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      const moduleId = canonicalModuleId(str(m.moduleId, null));
      if (!moduleId) continue;
      if (env.registry && !env.registry[moduleId]) continue; // unknown module
      modules.push({
        instanceId: uniqueId(m.instanceId, 'i', env, used),
        moduleId,
        height: normaliseHeight(m.height, env, moduleId),
      });
    }
    const width = finite(raw && raw.width);
    return {
      id: uniqueId(raw && raw.id, 'c', env, used),
      width: width && width > 0 ? width : null,
      modules,
    };
  }

  function normalisePalette(raw, index, columns, env, used) {
    const pos = raw && raw.pos && typeof raw.pos === 'object' ? raw.pos : {};
    const size = raw && raw.size && typeof raw.size === 'object' ? raw.size : {};
    const width = finite(size.width);
    const height = finite(size.height);
    const snap = SNAP_EDGES.includes(raw && raw.snap) ? raw.snap : null;
    return {
      id: uniqueId(raw && raw.id, 'p', env, used),
      name: str(raw && raw.name, `Palette ${index + 1}`),
      pos: {
        x: finite(pos.x),
        y: finite(pos.y),
        displayId: pos.displayId != null ? pos.displayId : null,
      },
      size: {
        width: width && width > 0 ? width : env.defaultSize.width,
        height: height && height > 0 ? height : env.defaultSize.height,
      },
      collapsed: Boolean(raw && raw.collapsed),
      snap,
      snapTo: snap ? str(raw && raw.snapTo, null) : null,
      columns,
    };
  }

  /**
   * Shape and validity: prune empty columns, repair duplicate ids, drop unknown
   * modules when a registry is given, default a missing size. It never moves
   * modules and never closes a palette — those are intent semantics.
   */
  function normalise(raw, opts) {
    const env = envOf(opts);
    const src = raw && typeof raw === 'object' ? raw : {};
    const used = new Set();
    const palettes = [];
    const list = Array.isArray(src.palettes) ? src.palettes : [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || typeof p !== 'object') continue;
      const columns = (Array.isArray(p.columns) ? p.columns : [])
        .map((c) => normaliseColumn(c, env, used))
        .filter((c) => c.modules.length > 0);
      palettes.push(normalisePalette(p, i, columns, env, used));
    }
    const ids = new Set(palettes.map((p) => p.id));
    for (const p of palettes) {
      if (p.snapTo && !ids.has(p.snapTo)) {
        p.snapTo = null;
        p.snap = null;
      }
    }
    // The number a *new* palette gets: the smallest "Palette N" not already in use, so
    // the counter cannot ratchet. It used to be persisted and only ever incremented, so
    // a session that added windows drifted to "Palette 34", "Palette 43"…
    const taken = new Set();
    for (const p of palettes) {
      const m = /^Palette (\d+)$/.exec(String(p.name || ''));
      if (m) taken.add(Number(m[1]));
    }
    // Instances that are hidden: kept (with their settings, which are keyed by instance id)
    // but placed in no column. An entry whose instance is placed again, or whose module is
    // gone, is dropped, so the list cannot drift from the document.
    const hiddenInstances = [];
    const seenHidden = new Set();
    for (const raw of Array.isArray(src.hiddenInstances) ? src.hiddenInstances : []) {
      const instanceId = str(raw && raw.instanceId, null);
      const moduleId = canonicalModuleId(str(raw && raw.moduleId, null));
      if (!instanceId || !moduleId || seenHidden.has(instanceId)) continue;
      // A module that no longer exists (removed from the manifest) cannot be shown again, so a
      // hidden entry for it is dead weight — drop it like a placed one.
      if (env.registry && !env.registry[moduleId]) continue;
      const placed = palettes.some((p) => p.columns.some((c) => c.modules.some((m) => m.instanceId === instanceId)));
      if (placed) continue;
      seenHidden.add(instanceId);
      hiddenInstances.push({ instanceId, moduleId });
    }
    // One-time migration markers: a document records the fixes it has already had, so a seed
    // never runs twice — and never re-adds a module the user deliberately removed.
    const seeded = [];
    for (const raw of Array.isArray(src.seeded) ? src.seeded : []) {
      const key = str(raw, null);
      if (key && !seeded.includes(key)) seeded.push(key);
    }
    let free = 1;
    while (taken.has(free)) free += 1;
    return { version: SCHEMA_VERSION, palettes, hiddenInstances, seeded, nextPaletteNumber: free };
  }

  // --- queries --------------------------------------------------------------

  function findPalette(doc, paletteId) {
    if (!doc || !Array.isArray(doc.palettes)) return null;
    return doc.palettes.find((p) => p.id === paletteId) || null;
  }

  /**
   * A palette's instances in document order (columns, then modules down each
   * column). This is the order a board's shift-click selection ranges over, and
   * the order a multi-module drag carries.
   *
   * Accepts either shape: a v2 document (`palettes`) or the v1 view the boards
   * hold (`{ version, columns, floats }`) — the boards have the view, and the
   * order rule should live in exactly one place.
   */
  function documentOrder(doc, paletteId) {
    if (doc && !Array.isArray(doc.palettes) && Array.isArray(doc.columns)) {
      const flat = [];
      for (const column of doc.columns) {
        for (const m of column.modules || []) flat.push(m.instanceId);
      }
      return flat;
    }
    const palette = paletteId ? findPalette(doc, paletteId) : (doc && doc.palettes ? doc.palettes[0] : null);
    if (!palette) return [];
    const out = [];
    for (const column of palette.columns || []) {
      for (const m of column.modules || []) out.push(m.instanceId);
    }
    return out;
  }

  /** The inclusive slice of `order` between two instances ([] if either is absent). */  function rangeBetween(order, from, to) {
    const list = Array.isArray(order) ? order : [];
    const a = list.indexOf(from);
    const b = list.indexOf(to);
    if (a < 0 || b < 0) return [];
    return a <= b ? list.slice(a, b + 1) : list.slice(b, a + 1);
  }

  function eachColumn(doc, fn) {
    if (!doc || !Array.isArray(doc.palettes)) return;
    for (const palette of doc.palettes) {
      for (const column of palette.columns) fn(column, palette);
    }
  }

  function allInstances(doc) {
    const out = [];
    eachColumn(doc, (column, palette) => {
      for (const module of column.modules) {
        out.push({ paletteId: palette.id, columnId: column.id, instanceId: module.instanceId, moduleId: module.moduleId });
      }
    });
    return out;
  }

  function instanceRef(doc, instanceId) {
    if (!doc || !Array.isArray(doc.palettes)) return null;
    for (let pi = 0; pi < doc.palettes.length; pi++) {
      const palette = doc.palettes[pi];
      for (let ci = 0; ci < palette.columns.length; ci++) {
        const column = palette.columns[ci];
        for (let mi = 0; mi < column.modules.length; mi++) {
          if (column.modules[mi].instanceId === instanceId) {
            return { palette, column, module: column.modules[mi], paletteIndex: pi, columnIndex: ci, moduleIndex: mi };
          }
        }
      }
    }
    return null;
  }

  const paletteOfInstance = (doc, instanceId) => {
    const ref = instanceRef(doc, instanceId);
    return ref ? ref.palette : null;
  };

  const moduleCount = (doc, paletteId) => {
    const palette = findPalette(doc, paletteId);
    if (!palette) return 0;
    return palette.columns.reduce((sum, c) => sum + c.modules.length, 0);
  };

  const totalInstances = (doc, moduleId) => allInstances(doc).filter((i) => i.moduleId === moduleId).length;

  // --- drop helpers ---------------------------------------------------------

  /** Every moving module, in document order. */
  function flatOrder(source, items) {
    const out = [];
    for (const column of source.columns) {
      for (const module of column.modules) {
        if (items.has(module.instanceId)) out.push(module);
      }
    }
    return out;
  }

  /** The moving modules grouped by their source column, preserving column order
   *  and each source column's width — the "whole palette" payload keeps its
   *  columns; a module selection flattens. */
  function columnGroups(source, items) {
    const groups = [];
    for (const column of source.columns) {
      const modules = column.modules.filter((m) => items.has(m.instanceId));
      if (modules.length) groups.push({ width: column.width, modules });
    }
    return groups;
  }

  /** Columns that will be gone once the moving modules are taken out. */
  function emptiedColumns(source, items) {
    const gone = new Set();
    for (const column of source.columns) {
      if (column.modules.length && column.modules.every((m) => items.has(m.instanceId))) gone.add(column.id);
    }
    return gone;
  }

  function clampIndex(value, length) {
    const n = finite(value);
    if (n == null) return length;
    return Math.max(0, Math.min(length, Math.floor(n)));
  }

  // --- intents --------------------------------------------------------------

  /**
   * The one drag/drop intent. `target` is a union:
   *   { kind:'column', paletteId, columnId, index }
   *   { kind:'seam',   paletteId, seamIndex }
   *   { kind:'outer',  paletteId, side:'left'|'right' }
   *   { kind:'desktop', pos, size }            -> a new palette
   * `grouping:'columns'` keeps the payload's own columns (a whole palette);
   * otherwise the items land as one run.
   *
   * `grown` (optional) is the drawn size of what is being placed — the item card, or a whole
   * palette's window — so the destination's new size can follow the one rule: a new column adds
   * its width, a row adds its height. Main applies it (`fitPane`); the reducer only carries it.
   */
  function intendPlace(doc, intent, env, effects) {
    const items = new Set(Array.isArray(intent.items) ? intent.items.filter((id) => typeof id === 'string') : []);
    if (!items.size) return { error: 'no-items' };
    const target = intent.target;
    if (!target || typeof target !== 'object') return { error: 'bad-target' };
    const grouping = intent.grouping === 'columns' ? 'columns' : 'flat';
    const grown = intent.grown && typeof intent.grown === 'object' ? intent.grown : {};
    const grownWidth = finite(grown.width) || 0;
    const grownHeight = finite(grown.height) || 0;

    const refs = [];
    for (const id of items) {
      const ref = instanceRef(doc, id);
      if (!ref) return { error: 'unknown-instance' };
      refs.push(ref);
    }
    const sourceId = str(intent.sourcePaletteId, refs[0].palette.id);
    if (refs.some((r) => r.palette.id !== sourceId)) return { error: 'mixed-source' };
    const source = findPalette(doc, sourceId);
    if (!source) return { error: 'unknown-source' };

    const moving = grouping === 'columns' ? columnGroups(source, items) : [{ width: null, modules: flatOrder(source, items) }];
    if (!moving.length || moving.every((g) => g.modules.length === 0)) return { error: 'no-items' };
    const gone = emptiedColumns(source, items);
    const hintWidth = finite(intent.width);
    const flat = moving.length === 1 ? moving[0].modules : moving.reduce((all, g) => all.concat(g.modules), []);

    const targetColumnId = target.kind === 'column' ? str(target.columnId, null) : null;
    // Take the modules out. A column is kept alive while it is the drop target,
    // so a drop back into the same column still has somewhere to land.
    for (const palette of doc.palettes) {
      // Work out what this costs the window's size before the columns are mutated (the refs point
      // at the live columns).
      const takenFromHere = refs.filter((r) => r.column && palette.columns.includes(r.column)).length;
      const removed = [];
      palette.columns = palette.columns.filter((column) => {
        column.modules = column.modules.filter((m) => !items.has(m.instanceId));
        const keep = column.modules.length > 0 || column.id === targetColumnId;
        if (!keep) removed.push(column);
        return keep;
      });
      // A column that leaves *this window for another* takes its width with it, so the columns
      // that remain keep their size instead of stretching. A module that leaves without taking a
      // column takes its *height* instead (docs/LAYOUT.md, "Snapping": the size rule). A move
      // inside one window changes nothing about its size and must not fit, and a palette that is
      // left with nothing closes instead (no fit for a window that is going away).
      const intoOtherWindow = !target.paletteId || target.paletteId !== palette.id;
      if (intoOtherWindow && palette.columns.length > 0) {
        if (removed.length) {
          effects.push({
            type: 'palette.fit',
            paletteId: palette.id,
            // `columnIds` lets main use its own measurement; `px` is the document's
            // estimate, used when there is no report (the widths there are hints).
            change: {
              kind: 'columns-removed',
              columnIds: removed.map((c) => c.id),
              px: removed.reduce((sum, c) => sum + (c.width || 0) + 8, 0),
            },
          });
        } else if (takenFromHere) {
          effects.push({
            type: 'palette.fit',
            paletteId: palette.id,
            change: { kind: 'module-removed', py: grownHeight * takenFromHere, count: takenFromHere },
          });
        }
      }
    }

    const insertColumns = (palette, at) => {
      const created = (grouping === 'columns' && moving.length > 1)
        ? moving.map((g) => ({ id: env.newId('c'), width: g.width, modules: g.modules }))
        : [{ id: env.newId('c'), width: hintWidth && hintWidth > 0 ? hintWidth : (moving[0].width || null), modules: flat }];
      palette.columns.splice(at, 0, ...created);
      return created;
    };

    if (target.kind === 'column') {
      const palette = findPalette(doc, target.paletteId);
      if (!palette) return { error: 'unknown-target' };
      const column = palette.columns.find((c) => c.id === target.columnId);
      if (!column) return { error: 'unknown-target' };
      // The index was measured before the modules were taken out: drop the ones
      // that used to sit in front of it (a selection dropped on its own span).
      let before = 0;
      const original = refs.filter((r) => r.column.id === target.columnId && r.moduleIndex < clampIndex(target.index, Infinity));
      before = original.length;
      column.modules.splice(clampIndex(target.index, column.modules.length + before) - before, 0, ...flat);
      // Rows stack vertically, so this grows the window's height by what was dropped in.
      effects.push({ type: 'palette.fit', paletteId: palette.id, change: { kind: 'module-added', py: grownHeight, count: flat.length } });
    } else if (target.kind === 'seam' || target.kind === 'outer') {
      const palette = findPalette(doc, target.paletteId);
      if (!palette) return { error: 'unknown-target' };
      let at;
      if (target.kind === 'outer') {
        at = target.side === 'left' ? 0 : palette.columns.length;
      } else {
        // A seam was measured before the source columns vanished.
        let removedBefore = 0;
        const raw = clampIndex(target.seamIndex, source.columns.length);
        for (let i = 0; i < raw; i++) if (gone.has(source.columns[i].id)) removedBefore += 1;
        at = Math.max(0, raw - removedBefore);
      }
      const created = insertColumns(palette, Math.min(at, palette.columns.length));
      const px = (grouping === 'columns' && moving.length > 1)
        ? created.reduce((sum, c) => sum + (c.width || 0), 0)
        : (created[0].width || 0);
      // A new column widens the window by what was dropped in (a whole palette carries its own
      // window width; a card the width it was drawn at).
      effects.push({ type: 'palette.fit', paletteId: palette.id, change: { kind: 'columns-added', px: grownWidth || px } });
    } else if (target.kind === 'desktop') {
      const name = `Palette ${doc.nextPaletteNumber}`;
      doc.nextPaletteNumber += 1;
      const pos = target.pos && typeof target.pos === 'object' ? target.pos : {};
      const size = target.size && typeof target.size === 'object' ? target.size : {};
      // Re-creating a whole window (a palette dropped out) keeps the window it came
      // from; a single module's new window is sized by whoever opens it, from the
      // box it was drawn in (main does that in `openPane`).
      const sourceSize = grouping === 'columns' && source ? source.size : null;
      const palette = {
        id: env.newId('p'),
        name,
        pos: { x: finite(pos.x), y: finite(pos.y), displayId: pos.displayId != null ? pos.displayId : null },
        size: {
          width: finite(size.width) || (sourceSize && finite(sourceSize.width)) || env.defaultSize.width,
          height: finite(size.height) || (sourceSize && finite(sourceSize.height)) || env.defaultSize.height,
        },
        collapsed: false,
        snap: null,
        snapTo: null,
        columns: [],
      };
      doc.palettes.push(palette);
      insertColumns(palette, 0);
      effects.push({ type: 'palette.fit', paletteId: palette.id, change: { kind: 'content' } });
    } else {
      return { error: 'bad-target' };
    }

    // A palette emptied by the drop closes — unless it is the only one, which
    // stays as an empty drop zone so the user is never left with no window.
    const live = doc.palettes.filter((p) => p.columns.length > 0);
    if (live.length) {
      doc.palettes = live;
    } else {
      const keep = doc.palettes[0];
      keep.columns = [{ id: env.newId('c'), width: null, modules: [] }];
      doc.palettes = [keep];
    }
    return {};
  }

  /**
   * Delete a palette and everything in it (the palette menu). The last palette cannot go: there
   * would be no window left to show anything, and a workspace must always have one.
   */
  function intendRemovePalette(doc, intent, env, effects) {
    const palette = findPalette(doc, intent.paletteId);
    if (!palette) return { error: 'unknown-palette' };
    if ((doc.palettes || []).length <= 1) return { error: 'last-palette' };
    doc.palettes = doc.palettes.filter((p) => p.id !== palette.id);
    // Anything that was joined to it comes free rather than pointing at a palette that is gone.
    for (const p of doc.palettes) {
      if (p.snapTo === palette.id) { p.snap = null; p.snapTo = null; }
    }
    // The window is closed by the lifecycle effect (`lifecycleEffects` sees it vanish), so this
    // handler only changes the document.
    return {};
  }

  function intendSetHeight(doc, intent, env) {
    const ref = instanceRef(doc, intent.instanceId);
    if (!ref) return { error: 'unknown-instance' };
    ref.module.height = normaliseHeight(intent.height, env, ref.module.moduleId);
    return {};
  }

  /**
   * Replace one palette's columns wholesale — a board saving the columns it drew.
   * `columns` is a v2 column list whose module heights are already normalised (the
   * codec runs in main). Only the named palette changes, so a board can never touch
   * another window's content (plan: palette equality).
   */
  function intendSetColumns(doc, intent) {
    const palette = findPalette(doc, intent.paletteId);
    if (!palette) return { error: 'unknown-palette' };
    if (!Array.isArray(intent.columns)) return { error: 'bad-columns' };
    palette.columns = intent.columns;
    // A board that emptied itself closes — unless it is the only palette (the same rule
    // a drop follows). `lifecycleEffects` turns the removal into `palette.close`.
    const empty = !palette.columns.some((c) => (c.modules || []).length > 0);
    if (empty && doc.palettes.length > 1) {
      doc.palettes = doc.palettes.filter((p) => p.id !== palette.id);
      for (const p of doc.palettes) {
        if (p.snapTo === palette.id) { p.snap = null; p.snapTo = null; }
      }
    }
    return {};
  }

  function intendSetWidth(doc, intent) {
    const palette = findPalette(doc, intent.paletteId);
    if (!palette) return { error: 'unknown-palette' };
    const list = Array.isArray(intent.widths) ? intent.widths : [];
    if (!list.length) return { error: 'no-widths' };
    for (const entry of list) {
      const column = palette.columns.find((c) => c.id === (entry && entry.columnId));
      if (!column) return { error: 'unknown-column' };
      const width = finite(entry.width);
      if (width != null && width <= 0) return { error: 'bad-width' };
      column.width = width;
    }
    return {};
  }

  function intendRename(doc, intent) {
    const palette = findPalette(doc, intent.paletteId);
    if (!palette) return { error: 'unknown-palette' };
    const name = typeof intent.name === 'string' ? intent.name.trim() : '';
    if (!name) return { error: 'bad-name' };
    palette.name = name.slice(0, MAX_NAME);
    return {};
  }

  function intendClose(doc, intent) {
    const index = doc.palettes.findIndex((p) => p.id === intent.paletteId);
    if (index < 0) return { error: 'unknown-palette' };
    if (doc.palettes.length <= 1) return { error: 'last-palette' };
    doc.palettes.splice(index, 1);
    return {};
  }

  function intendCreate(doc, intent, env) {
    const pos = intent.pos && typeof intent.pos === 'object' ? intent.pos : {};
    const size = intent.size && typeof intent.size === 'object' ? intent.size : {};
    doc.palettes.push({
      id: env.newId('p'),
      name: `Palette ${doc.nextPaletteNumber}`,
      pos: { x: finite(pos.x), y: finite(pos.y), displayId: pos.displayId != null ? pos.displayId : null },
      size: {
        width: finite(size.width) || env.defaultSize.width,
        height: finite(size.height) || env.defaultSize.height,
      },
      collapsed: false,
      snap: null,
      snapTo: null,
      columns: [],
    });
    doc.nextPaletteNumber += 1;
    return {};
  }

  /**
   * Duplicate a palette: a deep copy of its columns, with new instance ids (so the
   * copy's modules get their own settings, docs/LAYOUT.md N1), offset so it does not
   * sit exactly on the original, and opened by main. It is not attached to anything
   * (no snap) — a copy is a palette of its own, not a docked one.
   */
  function intendDuplicate(doc, intent, env) {
    const source = findPalette(doc, intent.paletteId);
    if (!source) return { error: 'unknown-palette' };
    const copy = {
      id: env.newId('p'),
      name: `${source.name || 'Palette'} copy`,
      pos: {
        x: Number.isFinite(source.pos.x) ? source.pos.x + 24 : null,
        y: Number.isFinite(source.pos.y) ? source.pos.y + 24 : null,
        displayId: source.pos.displayId != null ? source.pos.displayId : null,
      },
      size: { width: source.size.width, height: source.size.height },
      collapsed: Boolean(source.collapsed),
      snap: null,
      snapTo: null,
      columns: (source.columns || []).map((column) => ({
        id: env.newId('c'),
        width: column.width,
        modules: (column.modules || []).map((m) => ({
          instanceId: env.newId('i'),
          moduleId: m.moduleId,
          height: { ...m.height },
        })),
      })),
    };
    doc.palettes.push(copy);
    return { effects: [{ type: 'palette.open', paletteId: copy.id }] };
  }

  /**
   * Import a palette (Settings → Layout): a palette from a file, with fresh ids for
   * itself and its instances, so its modules are independent of any other palette's
   * (docs/LAYOUT.md, N1). Opened by main like any new palette.
   */
  function intendImport(doc, intent, env) {
    const src = intent.palette && typeof intent.palette === 'object' ? intent.palette : null;
    if (!src || !Array.isArray(src.columns)) return { error: 'bad-palette' };
    const pos = intent.pos && typeof intent.pos === 'object' ? intent.pos : {};
    const size = src.size && typeof src.size === 'object' ? src.size : {};
    const palette = {
      id: env.newId('p'),
      name: typeof src.name === 'string' && src.name ? src.name : `Palette ${doc.nextPaletteNumber}`,
      pos: { x: finite(pos.x), y: finite(pos.y), displayId: pos.displayId != null ? pos.displayId : null },
      size: {
        width: finite(size.width) || env.defaultSize.width,
        height: finite(size.height) || env.defaultSize.height,
      },
      collapsed: false,
      snap: null,
      snapTo: null,
      columns: src.columns.map((column) => ({
        id: env.newId('c'),
        width: column && Number.isFinite(column.width) ? column.width : null,
        modules: (((column && column.modules) || []))
          .filter((m) => m && (!env.registry || env.registry[m.moduleId]))
          .map((m) => ({
            instanceId: env.newId('i'),
            moduleId: m.moduleId,
            height: m.height && typeof m.height === 'object' ? { ...m.height } : defaultHeight(m.moduleId, env),
          })),
      })),
    };
    doc.palettes.push(palette);
    doc.nextPaletteNumber += 1;
    return { effects: [{ type: 'palette.open', paletteId: palette.id }] };
  }

  function intendSetCollapsed(doc, intent) {
    const palette = findPalette(doc, intent.paletteId);
    if (!palette) return { error: 'unknown-palette' };
    palette.collapsed = Boolean(intent.collapsed);
    return {};
  }

  function intendSetBounds(doc, intent) {
    const palette = findPalette(doc, intent.paletteId);
    if (!palette) return { error: 'unknown-palette' };
    if (intent.pos && typeof intent.pos === 'object') {
      const x = finite(intent.pos.x);
      const y = finite(intent.pos.y);
      if (x != null) palette.pos.x = x;
      if (y != null) palette.pos.y = y;
      if (intent.pos.displayId !== undefined) palette.pos.displayId = intent.pos.displayId;
    }
    if (intent.size && typeof intent.size === 'object') {
      const width = finite(intent.size.width);
      const height = finite(intent.size.height);
      if (width != null) {
        if (width <= 0) return { error: 'bad-size' };
        palette.size.width = width;
      }
      if (height != null) {
        if (height <= 0) return { error: 'bad-size' };
        palette.size.height = height;
      }
    }
    return {};
  }

  function intendSetSnap(doc, intent, env, effects) {
    const palette = findPalette(doc, intent.paletteId);
    if (!palette) return { error: 'unknown-palette' };
    const snap = SNAP_EDGES.includes(intent.snap) ? intent.snap : null;
    const requested = str(intent.snapTo, null);
    if (requested && !findPalette(doc, requested)) return { error: 'unknown-snap-target' };
    // With no anchor named, a snapped palette attaches to the primary one — v1's
    // floats followed the palette, and a caller only names an anchor when it has
    // another (docs/LAYOUT.md).
    const anchor = snap ? (requested || (doc.palettes[0] ? doc.palettes[0].id : null)) : null;
    palette.snap = anchor ? snap : null;
    palette.snapTo = anchor;
    // Attaching is also a *move*: the palette sits flush against that edge of its anchor, so a
    // snap group looks joined (docs/LAYOUT.md, "Snap zones"). The caller moves the window.
    if (anchor) {
      const target = findPalette(doc, anchor);
      if (target && target.id !== palette.id) {
        const w = palette.size.width;
        const h = palette.size.height;
        if (snap === 'left') { palette.pos.x = target.pos.x - w; palette.pos.y = target.pos.y; }
        else if (snap === 'right') { palette.pos.x = target.pos.x + target.size.width; palette.pos.y = target.pos.y; }
        else if (snap === 'top') { palette.pos.x = target.pos.x; palette.pos.y = target.pos.y - h; }
        else if (snap === 'bottom') { palette.pos.x = target.pos.x; palette.pos.y = target.pos.y + target.size.height; }
        if (effects) effects.push({ type: 'palette.setBounds', paletteId: palette.id, pos: { ...palette.pos } });
      }
    }
    return {};
  }

  function intendEnable(doc, intent, env, effects) {
    const moduleId = str(intent.moduleId, null);
    if (!moduleId) return { error: 'bad-module' };
    const def = env.registry ? env.registry[moduleId] : null;
    if (env.registry && !def) return { error: 'unknown-module' };
    if (def && def.instanceable === false && totalInstances(doc, moduleId) > 0) return { error: 'already-present' };
    const palette = findPalette(doc, intent.paletteId) || doc.palettes[0];
    if (!palette) return { error: 'no-palette' };
    // An explicitly lone module gets its own column (Settings → Add / Show /
    // Duplicate). Seeding and migration leave `lone` off and keep appending.
    let column;
    if (intent.lone === true) {
      column = { id: env.newId('c'), width: null, modules: [] };
      palette.columns.push(column);
    } else {
      if (!palette.columns.length) palette.columns.push({ id: env.newId('c'), width: null, modules: [] });
      column = palette.columns[palette.columns.length - 1];
    }
    // An instance id may be supplied (main mints it when it duplicates an instance, so it
    // can copy that instance's settings before the module is mounted); it is still
    // main-generated, and one that is already in use is ignored.
    const given = str(intent.instanceId, null);
    const taken = given && doc.palettes.some((p) => p.columns.some((c) => c.modules.some((m) => m.instanceId === given)));
    column.modules.push({
      instanceId: given && !taken ? given : env.newId('i'),
      moduleId,
      height: normaliseHeight(null, env, moduleId),
    });
    effects.push({ type: 'palette.fit', paletteId: palette.id, change: { kind: 'grow' } });
    return {};
  }

  /** Take one *instance* out of every palette (delete, or the first half of hide). */
  function unplaceInstance(doc, instanceId) {
    let found = false;
    for (const palette of doc.palettes) {
      palette.columns = palette.columns
        .map((column) => {
          if (column.modules.some((m) => m.instanceId === instanceId)) found = true;
          return { ...column, modules: column.modules.filter((m) => m.instanceId !== instanceId) };
        })
        .filter((column) => column.modules.length > 0);
    }
    return found;
  }

  function hiddenOf(doc, instanceId) {
    return (doc.hiddenInstances || []).find((h) => h.instanceId === instanceId) || null;
  }

  /** Hide an instance: it keeps its place in the document's memory and its settings, but
   *  no column holds it, so the board never mounts it. Reversible with `module.show`. */
  function intendHide(doc, intent) {
    const instanceId = str(intent.instanceId, null);
    if (!instanceId) return { error: 'bad-instance' };
    const placed = doc.palettes.some((p) => p.columns.some((c) => c.modules.some((m) => m.instanceId === instanceId)));
    if (!placed) {
      return hiddenOf(doc, instanceId) ? { noop: true } : { error: 'unknown-instance' };
    }
    // The module id has to be remembered: the settings file is keyed by instance id, and
    // showing it again re-creates the placement.
    let moduleId = null;
    for (const palette of doc.palettes) {
      for (const column of palette.columns) {
        for (const m of column.modules) if (m.instanceId === instanceId) moduleId = m.moduleId;
      }
    }
    // Removing the last module of the last palette would leave no window at all.
    const total = doc.palettes.reduce((n, p) => n + p.columns.reduce((k, c) => k + c.modules.length, 0), 0);
    if (total <= 1) return { error: 'last-module' };
    unplaceInstance(doc, instanceId);
    doc.palettes = doc.palettes.filter((p) => p.columns.length > 0 || p.id === doc.palettes[0].id);
    doc.hiddenInstances = [...(doc.hiddenInstances || []), { instanceId, moduleId }];
    return {};
  }

  /** Show a hidden instance again — the same instance id, so its settings come back. */
  function intendShow(doc, intent, env, effects) {
    const instanceId = str(intent.instanceId, null);
    if (!instanceId) return { error: 'bad-instance' };
    const entry = hiddenOf(doc, instanceId);
    if (!entry) return { error: 'not-hidden' };
    const palette = findPalette(doc, intent.paletteId) || doc.palettes[0];
    if (!palette) return { error: 'no-palette' };
    doc.hiddenInstances = (doc.hiddenInstances || []).filter((h) => h.instanceId !== instanceId);
    if (!palette.columns.length && intent.lone !== true) {
      palette.columns.push({ id: env.newId('c'), width: null, modules: [] });
    }
    let column;
    if (intent.lone === true) {
      column = { id: env.newId('c'), width: null, modules: [] };
      palette.columns.push(column);
    } else {
      column = palette.columns[palette.columns.length - 1];
    }
    column.modules.push({
      instanceId,
      moduleId: entry.moduleId,
      height: normaliseHeight(null, env, entry.moduleId),
    });
    effects.push({ type: 'palette.fit', paletteId: palette.id, change: { kind: 'grow' } });
    return {};
  }

  /** Delete an instance for good: out of every palette *and* out of the hidden list. */
  function intendRemove(doc, intent) {
    const instanceId = str(intent.instanceId, null);
    if (!instanceId) return { error: 'bad-instance' };
    const wasHidden = Boolean(hiddenOf(doc, instanceId));
    const wasPlaced = unplaceInstance(doc, instanceId);
    if (!wasHidden && !wasPlaced) return { error: 'unknown-instance' };
    if (wasPlaced) {
      const total = doc.palettes.reduce((n, p) => n + p.columns.reduce((k, c) => k + c.modules.length, 0), 0);
      if (total === 0) return { error: 'last-module' };
      doc.palettes = doc.palettes.filter((p) => p.columns.length > 0 || p.id === doc.palettes[0].id);
    }
    doc.hiddenInstances = (doc.hiddenInstances || []).filter((h) => h.instanceId !== instanceId);
    return {};
  }

  /** Record a one-time migration marker (see `normalise`). Idempotent. */
  function intendMarkSeeded(doc, intent) {
    const key = str(intent.key, null);
    if (!key) return { error: 'bad-key' };
    if (!Array.isArray(doc.seeded)) doc.seeded = [];
    if (!doc.seeded.includes(key)) doc.seeded.push(key);
    return {};
  }

  function intendDisable(doc, intent) {
    const moduleId = str(intent.moduleId, null);
    if (!moduleId) return { error: 'bad-module' };
    if (totalInstances(doc, moduleId) === 0) return { error: 'unknown-module' };
    for (const palette of doc.palettes) {
      palette.columns = palette.columns
        .map((column) => ({ ...column, modules: column.modules.filter((m) => m.moduleId !== moduleId) }))
        .filter((column) => column.modules.length > 0);
    }
    doc.palettes = doc.palettes.filter((p) => p.columns.length > 0);
    if (!doc.palettes.length) return { error: 'no-palette' };
    return {};
  }

  const INTENTS = {
    'layout.place': intendPlace,
    'module.setHeight': intendSetHeight,
    'column.setWidth': intendSetWidth,
    'layout.setColumns': intendSetColumns,
    'palette.rename': intendRename,
    'palette.close': intendClose,
      'palette.create': intendCreate,
      'palette.duplicate': intendDuplicate,
      'palette.import': intendImport,
    'palette.setCollapsed': intendSetCollapsed,
    'palette.setBounds': intendSetBounds,
    'palette.setSnap': intendSetSnap,
    'module.enable': intendEnable,
    'module.hide': intendHide,
    'module.show': intendShow,
    'module.remove': intendRemove,
    'module.disable': intendDisable,
    'palette.remove': intendRemovePalette,
    'layout.markSeeded': intendMarkSeeded,
  };

  /** Palettes that appeared or vanished. Size/snap effects are emitted by the
   *  handlers, because "fit to content" needs the geometry layer. */
  function lifecycleEffects(before, after) {
    const effects = [];
    const beforeIds = new Set(before.palettes.map((p) => p.id));
    const afterIds = new Set(after.palettes.map((p) => p.id));
    for (const p of after.palettes) if (!beforeIds.has(p.id)) effects.push({ type: 'palette.open', paletteId: p.id });
    for (const p of before.palettes) if (!afterIds.has(p.id)) effects.push({ type: 'palette.close', paletteId: p.id });
    return effects;
  }

  /**
   * Apply one intent. Pure: the input document is never mutated.
   * @returns {{ok:boolean, doc:object, effects:Array, error?:string, noop?:boolean}}
   */
  function reduce(docInput, intent, opts) {
    const env = envOf(opts);
    const before = normalise(docInput, opts);
    if (!intent || typeof intent.type !== 'string') return fail('bad-intent', before);

    if (intent.type === 'workspace.load') {
      if (!intent.doc) return fail('bad-document', before);
      const next = normalise(intent.doc, opts);
      return { ok: true, doc: next, effects: lifecycleEffects(before, next) };
    }

    const handler = INTENTS[intent.type];
    if (!handler) return fail('unknown-intent', before);

    const working = clone(before);
    const effects = [];
    const out = handler(working, intent, env, effects) || {};
    if (out.error) return fail(out.error, before);

    const after = normalise(working, opts);
    if (same(after, before)) return { ok: true, doc: before, effects: [], noop: true };
    return { ok: true, doc: after, effects: effects.concat(lifecycleEffects(before, after)) };
  }

  /** The layout a fresh install starts from. */
  function defaultWorkspace(opts) {
    const env = envOf(opts);
    const ids = env.newId;
    const doc = {
      version: SCHEMA_VERSION,
      palettes: [{
        id: ids('p'),
        name: 'Palette 1',
        pos: { x: null, y: null, displayId: null },
        size: { width: env.defaultSize.width, height: env.defaultSize.height },
        collapsed: false,
        snap: null,
        snapTo: null,
        columns: [{
          id: ids('c'),
          width: null,
          modules: ['csp-color', 'color-slices', 'color-slider'].map((moduleId) => ({
            instanceId: ids('i'),
            moduleId,
            height: normaliseHeight(null, env, moduleId),
          })),
        }],
      }],
      nextPaletteNumber: 2,
    };
    return normalise(doc, opts);
  }

  /**
   * Every instance id the document still owns: placed in a palette column, or kept
   * hidden. The hidden set is `{instanceId, moduleId}` objects, so a caller that
   * pushes them raw feeds "[object Object]" to the trash sweep and the settings
   * files of hidden instances look unused (docs/INVARIANTS.md).
   */
  function liveInstanceIds(doc) {
    const ids = [];
    for (const palette of (doc && doc.palettes) || []) {
      for (const column of palette.columns || []) {
        for (const m of column.modules || []) if (m && m.instanceId) ids.push(m.instanceId);
      }
    }
    for (const h of (doc && doc.hiddenInstances) || []) {
      const id = h && typeof h === 'object' ? h.instanceId : h;
      if (id) ids.push(id);
    }
    return ids;
  }

  return {
    SCHEMA_VERSION,
    SNAP_EDGES,
    DEFAULT_WEIGHT,
    DEFAULT_COLUMN_WIDTH,
    DEFAULT_PALETTE_SIZE,
    MAX_NAME,
    RATIO_MIN,
    RATIO_MAX,
    ratioFromDrag,
    INTENT_TYPES: Object.keys(INTENTS),
    idFactory,
    normalise,
    reduce,
    defaultWorkspace,
    findPalette,
    findInstance: instanceRef,
    instanceRef,
    paletteOfInstance,
    moduleCount,
    totalInstances,
    allInstances,
    documentOrder,
    rangeBetween,
    eachColumn,
    liveInstanceIds,
    normaliseHeight,
    LEGACY_MODULE_IDS,
    canonicalModuleId,
  };
});

'use strict';

// The workspace document, owned by main.
//
// Everything that touches layout.json goes through one service, which holds the
// document in memory and is the only thing that writes it — atomically, debounced,
// from a single place. That is what removes the read-modify-write races: two
// writers used to each read the file, change one part of it and write the whole
// thing back, so one of the two changes was regularly lost.
//
// The service speaks both v2 (the document, docs/LAYOUT.md) and v1 (the board and
// the float layer, via `layout-view.js`). `apply()` runs a real intent through the
// reducer; the v1 writers go through `writeV1()`, which is transitional and is
// deleted as each caller becomes an intent.
//
// Electron-free: the store, the id factory and the timer are injected, so the
// whole thing is headless-testable.

const Model = require('../shared/layout-model');
const View = require('./layout-view');
const Codec = require('../shared/layout-codec');

/** The default debounce before the document reaches the disk. */
const WRITE_DELAY_MS = 250;

function defaultSchedule(fn, ms) {
  const timer = setTimeout(fn, ms);
  // Never hold the process open just to save the layout.
  if (timer && typeof timer.unref === 'function') timer.unref();
  return () => clearTimeout(timer);
}

/**
 * @param {{store: object, registry?: object, newId?: Function, debounceMs?: number,
 *          schedule?: (fn: Function, ms: number) => Function}} options
 */
function createLayoutService(options) {
  const opts = options || {};
  if (!opts.store) throw new Error('createLayoutService needs a store');
  const store = opts.store;
  const registry = opts.registry || null;
  const newId = opts.newId || Model.idFactory();
  const debounceMs = Number.isFinite(opts.debounceMs) ? opts.debounceMs : WRITE_DELAY_MS;
  const schedule = typeof opts.schedule === 'function' ? opts.schedule : defaultSchedule;

  const listeners = [];
  let doc = null;
  let rev = 0;
  let dirty = false;
  let pending = false;
  let cancelTimer = null;
  let fromDisk = false;

  const writeCtx = () => ({ registry, newId });

  function load() {
    const read = store.read();
    fromDisk = Boolean(read);
    doc = read || Model.defaultWorkspace({ registry, newId });
    return doc;
  }

  const ensure = () => doc || load();

  /** The live v2 document. Callers must not mutate it. */
  const current = () => ensure();

  /** The v1 view the board and the float layer read (never null). */
  const v1 = () => View.docToV1(ensure());

  const findFloat = (floatId) => v1().floats.find((f) => f.floatId === floatId) || null;

  /** One palette of the live document (main-side callers only). */
  const palette = (paletteId) => Model.findPalette(ensure(), paletteId);

  /** One palette's columns, v2-native — what a board reads for its own window. */
  function paletteColumns(paletteId) {
    const p = palette(paletteId);
    return p ? JSON.parse(JSON.stringify(p.columns)) : null;
  }

  /**
   * Replace one palette's columns from a v1 column list — the board's own write.
   * The codec runs here in main, so a window never invents an instance id or a height.
   */
  function setColumns(paletteId, v1Columns) {
    const p = palette(paletteId);
    if (!p) return { ok: false, error: 'unknown-palette' };
    const columns = Codec.columnsFromV1(v1Columns, p.columns, writeCtx());
    return apply({ type: 'layout.setColumns', paletteId, columns });
  }

  /** True when a workspace was loaded from disk (as opposed to the default), so
   *  a first run can be told apart from a saved-but-empty board. */
  function hasStoredDoc() {
    ensure();
    return fromDisk;
  }

  const revisions = () => rev;

  function emit(kind) {
    for (const listener of listeners.slice()) {
      try {
        listener({ rev, kind, doc });
      } catch (err) {
        console.warn('layout listener failed:', err && err.message);
      }
    }
  }

  function scheduleWrite() {
    if (pending || !dirty) return;
    pending = true;
    cancelTimer = schedule(() => {
      pending = false;
      cancelTimer = null;
      flush();
    }, debounceMs);
  }

  /** Write the document now (also used on quit). */
  function flush() {
    if (!dirty || !doc) return false;
    const ok = store.write(doc);
    if (ok) dirty = false;
    return ok;
  }

  /** Bump the revision, notify and schedule the save. */
  function commit(next, kind) {
    if (process.env.IRO_TRACE_LAYOUT) {
      const at = (new Error().stack || '').split('\n').slice(2, 6)
        .map((l) => (l.match(/([\w.-]+\.js:\d+)/) || [])[1] || '?').join(' < ');
      const mods = (next.palettes || []).map((p) => `${p.name}:${p.columns.reduce((n, c) => n + c.modules.length, 0)}`);
      console.log('[commit]', kind, at, JSON.stringify(mods));
    }
    doc = next;
    rev += 1;
    dirty = true;
    scheduleWrite();
    emit(kind);
    return { ok: true, rev };
  }

  /**
   * Apply a v1 document (transitional — see layout-view.js for the semantics:
   * `columns` replaces the primary palette's columns, `floats` replaces the whole
   * float set, and an absent key leaves that part alone).
   */
  function writeV1(v1doc) {
    const next = View.applyV1Doc(ensure(), v1doc, writeCtx());
    // A float drag writes the document back on every move; an unchanged one must
    // not bump the revision or schedule a save.
    if (JSON.stringify(next) === JSON.stringify(doc)) return { ok: true, rev, noop: true };
    return commit(next, 'v1');
  }

  /** Apply one intent through the pure reducer (the way forward). */
  function apply(intent) {
    const out = Model.reduce(ensure(), intent, writeCtx());
    if (!out.ok) return out;
    if (out.noop) return { ...out, rev };
    const result = commit(out.doc, 'intent');
    return { ...out, rev: result.rev };
  }

  /** Subscribe to changes. Returns an unsubscribe. */
  function on(listener) {
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  }

  /** Flush and stop the timer (on quit). */
  function dispose() {
    if (cancelTimer) {
      cancelTimer();
      cancelTimer = null;
    }
    pending = false;
    flush();
  }

  return {
    load,
    current,
    v1,
    findFloat,
    palette,
    hasStoredDoc,
    revisions,
    writeV1,
    paletteColumns,
    setColumns,
    apply,
    flush,
    dispose,
    on,
    // Exposed so main can mint the id for a *duplicate* before the module is mounted (it
    // has to copy that instance's settings file first).
    newId,
  };
}

module.exports = { createLayoutService, WRITE_DELAY_MS };

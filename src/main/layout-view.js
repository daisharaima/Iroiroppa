'use strict';

// The schema-v1 view of the workspace document.
//
// Main owns the v2 workspace (a list of palettes — docs/LAYOUT.md), but the board
// and the float layer still speak schema v1: `columns` whose modules carry a
// `weight`, plus an array of float entries with `x`/`y`/`width`/`height`/`snap`.
// Rather than translate in three places, all of it lives here, and the layout
// service serves and accepts v1.
//
// v1 cannot *name* a height: `weight: null` means "the module's own default" and
// a number is a share. So:
//
//   fill(N) <-> N            auto <-> null (when the stored height was auto)
//   px(P)   <-> null (when the stored height was px)
//
// i.e. a px height reads back as null and a null write keeps the stored px, so a
// v1 round-trip is lossless for every document a v1 writer can produce — a v1
// board can never *change* a px height because it cannot express one. This is
// transitional: fine-grained intents replace the whole-document writes, and then
// this file, and the `weight` key, go.

const Model = require('../shared/layout-model');
const Codec = require('../shared/layout-codec');

// The column codec now lives in shared code (plan P1) so the boards and main use one
// copy; the document-level v1 mapping below is what is transitional, not this.
const {
  finite, heightToV1, heightRatioToV1, heightFromV1, heightEntryFromV1, columnsToV1, columnsFromV1,
} = Codec;

const DEFAULT_FLOAT_SIZE = 260;
const SNAP_EDGES = Model.SNAP_EDGES;

/** A float palette as a v1 float entry. `collapsed` is not a v1 field, but the
 *  float layer needs it to reopen a window in the state it was left. */
function floatFromPalette(palette) {
  return {
    floatId: palette.id,
    x: palette.pos.x,
    y: palette.pos.y,
    width: palette.size.width,
    height: palette.size.height,
    snap: palette.snap,
    collapsed: Boolean(palette.collapsed),
    columns: columnsToV1(palette),
  };
}

/** The whole document as v1: the primary palette's columns, then the floats. */
function docToV1(doc) {
  const palettes = (doc && doc.palettes) || [];
  return {
    version: 1,
    columns: palettes[0] ? columnsToV1(palettes[0]) : [],
    floats: palettes.slice(1).map(floatFromPalette),
  };
}

/** A v1 float entry as a palette (reusing `existing` when there is one). */
function paletteFromFloat(existing, float, ctx) {
  const width = finite(float.width);
  const height = finite(float.height);
  const snap = SNAP_EDGES.includes(float.snap) ? float.snap : null;
  const columns = Array.isArray(float.columns) ? float.columns : null;
  // A palette that already exists keeps everything but its columns. Position, size, snap and
  // collapsed belong to the workspace document — main is their only writer — so a window's own
  // save can never push a stale position back over a move the drag session just committed, or
  // drop a join it just recorded. (That is what made a palette jump back on the next launch.)
  // A float we have never seen is created from the v1 record, which is how an upgrade bootstraps.
  if (existing) {
    return {
      ...existing,
      columns: columns ? columnsFromV1(columns, existing.columns, ctx) : existing.columns,
    };
  }
  return {
    id: String(float.floatId),
    name: 'Palette',
    pos: { x: finite(float.x), y: finite(float.y), displayId: null },
    size: {
      width: width && width > 0 ? width : DEFAULT_FLOAT_SIZE,
      height: height && height > 0 ? height : DEFAULT_FLOAT_SIZE,
    },
    collapsed: typeof float.collapsed === 'boolean' ? float.collapsed : false,
    snap,
    snapTo: null,
    columns: columns ? columnsFromV1(columns, [], ctx) : [],
  };
}

/**
 * Apply a v1 document onto the workspace. The semantics match the v1 writers
 * exactly:
 *   - `columns` present  -> replaces the primary palette's columns
 *   - `columns` absent   -> the primary palette is untouched
 *   - `floats` present   -> the whole float set (so a removed float disappears)
 *   - `floats` absent    -> the floats are untouched
 * @param {object} doc the current workspace (not mutated)
 * @param {object} v1 the incoming v1 document
 * @param {{registry?: object, newId: Function}} ctx
 */
function applyV1Doc(doc, v1, ctx) {
  const next = JSON.parse(JSON.stringify(doc));
  const palettes = next.palettes || [];
  if (!palettes.length) {
    palettes.push({
      id: ctx.newId('p'),
      name: 'Palette 1',
      pos: { x: null, y: null, displayId: null },
      size: { width: 300, height: 640 },
      collapsed: false,
      snap: null,
      snapTo: null,
      columns: [],
    });
  }
  if (Array.isArray(v1 && v1.columns)) {
    palettes[0].columns = columnsFromV1(v1.columns, palettes[0].columns, ctx);
  }
  if (Array.isArray(v1 && v1.floats)) {
    const byId = new Map(palettes.slice(1).map((p) => [p.id, p]));
    const kept = [];
    // A float the workspace has not seen gets the next palette name, so a new
    // window is never an anonymous "Palette".
    let counter = finite(next.nextPaletteNumber) || palettes.length + 1;
    for (const float of v1.floats) {
      if (!float || float.floatId == null) continue;
      const existing = byId.get(String(float.floatId));
      const palette = paletteFromFloat(existing, float, ctx);
      if (!existing) palette.name = `Palette ${counter++}`;
      kept.push(palette);
    }
    // v1 floats were snapped to the palette, so default the anchor to it.
    for (const palette of kept) {
      if (palette.snap && !palette.snapTo) palette.snapTo = palettes[0].id;
    }
    // A palette the v1 doc does not mention is *kept*: only `palette.close` and
    // `workspace.load` remove a palette now, and this bridge must never lose one —
    // a duplicate, for instance, has a window but no v1 entry yet when the board's
    // own save lands (docs/LAYOUT.md, V6).
    const listed = new Set(kept.map((p) => p.id));
    const untouched = palettes.slice(1).filter((p) => !listed.has(p.id));
    next.palettes = [palettes[0], ...kept, ...untouched];
    next.nextPaletteNumber = Math.max(counter, kept.length + untouched.length + 2);
  } else {
    next.palettes = palettes;
  }
  return Model.normalise(next, { registry: ctx.registry });
}

module.exports = {
  heightToV1,
  heightRatioToV1,
  heightFromV1,
  heightEntryFromV1,
  columnsToV1,
  columnsFromV1,
  floatFromPalette,
  paletteFromFloat,
  docToV1,
  applyV1Doc,
};

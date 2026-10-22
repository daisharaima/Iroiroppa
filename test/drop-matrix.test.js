'use strict';

// The drop matrix (docs/LAYOUT.md, V5): every payload × destination, asserted on
// the document the reducer produces and on the effects main will act on. This is
// the contract that used to be a set of behaviours nobody could enumerate — which
// is why "main to float", "float to main" and the rest kept breaking.

const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/shared/layout-model');

const REG = {
  'csp-color': { autoHeight: true, instanceable: false },
  'color-slices': {},
  'color-slider': {},
};

let seq = 0;
const newId = (prefix) => { seq += 1; return `${prefix}${seq}`; };

const mod = (id, moduleId = 'color-slices') => ({ instanceId: id, moduleId, height: { mode: 'fill', weight: 1 } });
const col = (id, ids) => ({ id, width: null, modules: ids.map((i) => mod(i)) });
const pal = (id, name, cols) => ({
  id,
  name,
  columns: cols,
  pos: { x: 0, y: 0, displayId: null },
  size: { width: 300, height: 600 },
  collapsed: false,
  snap: null,
  snapTo: null,
});

/** p1: c1 [i1, i2], c2 [i3]. p2: d1 [i4]. */
function base() {
  return Model.normalise({
    version: 2,
    palettes: [pal('p1', 'Palette 1', [col('c1', ['i1', 'i2']), col('c2', ['i3'])]), pal('p2', 'Palette 2', [col('d1', ['i4'])])],
    nextPaletteNumber: 3,
  }, { registry: REG });
}

/** The document as { palettes: [ [ [instanceId] ] ] }. */
const shape = (doc) => doc.palettes.map((p) => p.columns.map((c) => c.modules.map((m) => m.instanceId)));
const effects = (out) => out.effects.map((e) => e.type + (e.change ? `:${e.change.kind}` : ''));

function place(doc, items, target, extra = {}) {
  const out = Model.reduce(doc, { type: 'layout.place', items, target, ...extra }, { registry: REG, newId });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  return out;
}

// --- payload: one module (M1) -------------------------------------------------

test('M1 → column body: inserted at the index, nothing else moves', () => {
  const out = place(base(), ['i1'], { kind: 'column', paletteId: 'p2', columnId: 'd1', index: 0 });
  assert.deepEqual(shape(out.doc), [[['i2'], ['i3']], [['i1', 'i4']]]);
  // The source gives back the row's height; the destination takes it (docs/LAYOUT.md, "Snapping").
  assert.deepEqual(effects(out), ['palette.fit:module-removed', 'palette.fit:module-added']);
});

test('M1 → seam: a new column appears at that boundary', () => {
  const out = place(base(), ['i1'], { kind: 'seam', paletteId: 'p1', seamIndex: 1 });
  assert.deepEqual(out.doc.palettes[0].columns.map((c) => c.modules.map((m) => m.instanceId)), [['i2'], ['i1'], ['i3']]);
  assert.deepEqual(effects(out), ['palette.fit:columns-added']);
});

test('M1 → the seam it already sits on keeps the arrangement', () => {
  // i3 lives in the column to the right of the seam it is dropped on. The columns
  // are re-created (so their ids change) but nothing a user sees moves.
  const out = Model.reduce(base(), {
    type: 'layout.place',
    items: ['i3'],
    target: { kind: 'seam', paletteId: 'p1', seamIndex: 1 },
  }, { registry: REG, newId });
  assert.equal(out.ok, true);
  assert.deepEqual(shape(out.doc)[0], [['i1', 'i2'], ['i3']]);
});

test('M1 → outer left/right: a new outer column, and the window grows', () => {
  const left = place(base(), ['i3'], { kind: 'outer', paletteId: 'p1', side: 'left' });
  assert.deepEqual(left.doc.palettes[0].columns.map((c) => c.modules.map((m) => m.instanceId)), [['i3'], ['i1', 'i2']]);
  assert.deepEqual(effects(left), ['palette.fit:columns-added']);

  const right = place(base(), ['i3'], { kind: 'outer', paletteId: 'p1', side: 'right' });
  assert.deepEqual(right.doc.palettes[0].columns.map((c) => c.modules.map((m) => m.instanceId)), [['i1', 'i2'], ['i3']]);
});

test('M1 → desktop: a new window holding one column', () => {
  const out = place(base(), ['i1'], { kind: 'desktop' });
  assert.deepEqual(shape(out.doc), [[['i2'], ['i3']], [['i4']], [['i1']]]);
  assert.deepEqual(effects(out), ['palette.fit:module-removed', 'palette.fit:content', 'palette.open']);
  assert.match(out.doc.palettes[2].name, /^Palette 3$/);
});

test('M1 → its own position is a no-op, and the reducer says so', () => {
  const out = Model.reduce(base(), {
    type: 'layout.place',
    items: ['i2'],
    target: { kind: 'column', paletteId: 'p1', columnId: 'c1', index: 1 },
  }, { registry: REG, newId });
  assert.equal(out.ok, true);
  assert.equal(out.noop, true);
  assert.deepEqual(out.effects, []);
});

// --- the size rule ------------------------------------------------------------

test('the size rule: a row adds its height, a column adds its width, and both come back', () => {
  const fits = (out) => out.effects
    .filter((e) => e.type === 'palette.fit')
    .map((e) => [e.paletteId, e.change.kind, e.change.py || e.change.px || 0]);

  // Into a column: the row's *height* travels with it, both ways.
  const intoColumn = place(base(), ['i1'], { kind: 'column', paletteId: 'p2', columnId: 'd1', index: 0 },
    { grown: { width: 180, height: 90 } });
  assert.deepEqual(fits(intoColumn), [['p1', 'module-removed', 90], ['p2', 'module-added', 90]]);

  // A new column: the *width* — a docked palette brings its own window width.
  const asColumn = place(base(), ['i1'], { kind: 'outer', paletteId: 'p2', side: 'right' },
    { grown: { width: 180, height: 90 } });
  assert.deepEqual(fits(asColumn), [['p1', 'module-removed', 90], ['p2', 'columns-added', 180]]);

  // A column that leaves takes its width with it (the document's estimate: 8 for the seam here).
  const out = place(base(), ['i1', 'i2'], { kind: 'desktop' }, { grown: { width: 200, height: 40 } });
  const goneEffect = out.effects.find((e) => e.change && e.change.kind === 'columns-removed');
  assert.ok(goneEffect, 'a removed column must ask the window to give its width back');
  assert.ok(goneEffect.change.px > 0);
});

test('M2 → column body: the selection lands in order, as one run', () => {
  const out = place(base(), ['i1', 'i3'], { kind: 'column', paletteId: 'p2', columnId: 'd1', index: 0 });
  assert.deepEqual(shape(out.doc), [[['i2']], [['i1', 'i3', 'i4']]]);
});

test('M2 → seam stays ONE new column (a selection is flat)', () => {
  const out = place(base(), ['i1', 'i2'], { kind: 'seam', paletteId: 'p2', seamIndex: 1 });
  assert.deepEqual(shape(out.doc), [[['i3']], [['i4'], ['i1', 'i2']]]);
});

test('M2 → desktop makes one window with one column', () => {
  const out = place(base(), ['i1', 'i3'], { kind: 'desktop' });
  assert.deepEqual(shape(out.doc)[2], [['i1', 'i3']]);
});

test('M2 → dropped inside its own span adjusts the index instead of jumping', () => {
  // i1 already sits before i2; dropping the pair back at index 2 must not move it.
  const out = place(base(), ['i1', 'i2'], { kind: 'column', paletteId: 'p1', columnId: 'c1', index: 2 });
  assert.deepEqual(shape(out.doc)[0], [['i1', 'i2'], ['i3']]);
});

// --- payload: a whole palette (P3) -------------------------------------------

test('P3 → a column merges its modules in, keeping their order', () => {
  const out = place(base(), ['i1', 'i2', 'i3'], { kind: 'column', paletteId: 'p2', columnId: 'd1', index: 0 }, { grouping: 'columns' });
  assert.deepEqual(shape(out.doc), [[['i1', 'i2', 'i3', 'i4']]]);
  // The emptied source palette closes: nothing to fit for a window that is going away. The
  // destination does grow — its rows take the docked height (docs/LAYOUT.md, "Snapping").
  assert.deepEqual(effects(out), ['palette.fit:module-added', 'palette.close']);
});

test('P3 → a seam keeps its columns apart', () => {
  const out = place(base(), ['i1', 'i2', 'i3'], { kind: 'seam', paletteId: 'p2', seamIndex: 0 }, { grouping: 'columns' });
  assert.deepEqual(shape(out.doc), [[['i1', 'i2'], ['i3'], ['i4']]]);
  assert.deepEqual(effects(out), ['palette.fit:columns-added', 'palette.close']);
});

test('P3 → the desktop recreates the whole window, columns and all', () => {
  const out = place(base(), ['i1', 'i2', 'i3'], { kind: 'desktop' }, { grouping: 'columns' });
  assert.deepEqual(shape(out.doc), [[['i4']], [['i1', 'i2'], ['i3']]]);
  assert.deepEqual(effects(out), ['palette.fit:content', 'palette.open', 'palette.close']);
  // Re-creating a whole window keeps that window's size.
  const source = base().palettes[0].size;
  assert.deepEqual(out.doc.palettes[1].size, source);
});

test('P3 → back onto its own layout keeps the arrangement', () => {
  // Not a byte-level no-op (the columns are re-created, so their ids change), but
  // nothing a user can see moves — which is the property that matters.
  const out = Model.reduce(base(), {
    type: 'layout.place',
    items: ['i1', 'i2', 'i3'],
    grouping: 'columns',
    target: { kind: 'seam', paletteId: 'p1', seamIndex: 1 },
  }, { registry: REG, newId });
  assert.equal(out.ok, true);
  assert.deepEqual(shape(out.doc), [[['i1', 'i2'], ['i3']], [['i4']]]);
});

// --- guards -------------------------------------------------------------------

test('the last palette is never left empty', () => {
  const single = Model.normalise({
    version: 2,
    palettes: [pal('p1', 'Palette 1', [col('c1', ['i1'])])],
    nextPaletteNumber: 2,
  }, { registry: REG });
  const out = place(single, ['i1'], { kind: 'desktop' });
  assert.equal(out.doc.palettes.length, 1);
  assert.deepEqual(shape(out.doc), [[['i1']]]);
});

test('an unknown instance, a mixed source and a bad target are all refused', () => {
  const bad = (intent) => Model.reduce(base(), intent, { registry: REG, newId });
  assert.equal(bad({ type: 'layout.place', items: ['nope'], target: { kind: 'desktop' } }).error, 'unknown-instance');
  assert.equal(bad({ type: 'layout.place', items: ['i1', 'i4'], target: { kind: 'desktop' } }).error, 'mixed-source');
  assert.equal(bad({ type: 'layout.place', items: ['i1'], target: { kind: 'nonsense' } }).error, 'bad-target');
  assert.equal(bad({ type: 'layout.place', items: [], target: { kind: 'desktop' } }).error, 'no-items');
});

test('every cell leaves the same module ids in the document — nothing is lost', () => {
  const cells = [
    ['i1', { kind: 'column', paletteId: 'p2', columnId: 'd1', index: 0 }],
    ['i3', { kind: 'seam', paletteId: 'p1', seamIndex: 0 }],
    ['i1', { kind: 'outer', paletteId: 'p1', side: 'left' }],
    ['i4', { kind: 'outer', paletteId: 'p2', side: 'right' }],
    ['i2', { kind: 'desktop' }],
  ];
  for (const [item, target] of cells) {
    const out = place(base(), [item], target);
    const seen = out.doc.palettes.flatMap((p) => p.columns.flatMap((c) => c.modules.map((m) => m.instanceId))).sort();
    assert.deepEqual(seen, ['i1', 'i2', 'i3', 'i4'], `${item} -> ${target.kind}`);
  }
});

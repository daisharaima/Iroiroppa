'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const View = require('../src/main/layout-view');
const Model = require('../src/shared/layout-model');

const REGISTRY = {
  'csp-color': { autoHeight: true, instanceable: false },
  'color-slices': {},
  'color-slider': { autoHeight: true },
};

function idGen() {
  let n = 0;
  return (prefix) => `${prefix}_n${(n += 1)}`;
}

const CTX = { registry: REGISTRY, newId: idGen() };

const mod = (instanceId, moduleId, height) => ({ instanceId, moduleId, height });
const col = (id, modules, width = null) => ({ id, width, modules });

function palette(columns, extra) {
  return {
    id: 'p1',
    name: 'Palette 1',
    pos: { x: 10, y: 20, displayId: 1 },
    size: { width: 300, height: 600 },
    collapsed: false,
    snap: null,
    snapTo: null,
    columns,
    ...(extra || {}),
  };
}

const doc = (palettes) =>
  Model.normalise({ version: 2, palettes, nextPaletteNumber: palettes.length + 1 }, { registry: REGISTRY });

const fill = (weight) => ({ mode: 'fill', weight });
/** A v1 module: the shape the board and the float layer send. */
const vmod = (instanceId, moduleId, weight) => ({ instanceId, moduleId, weight });

// --- the weight <-> height mapping ----------------------------------------

test('a v1 weight is a fill share, and a null weight is the module default', () => {
  assert.deepEqual(View.heightFromV1(5, undefined, REGISTRY, 'color-slices'), fill(5));
  assert.equal(View.heightToV1(fill(5)), 5);
  assert.deepEqual(View.heightFromV1(null, undefined, REGISTRY, 'csp-color'), { mode: 'auto' });
  assert.deepEqual(View.heightFromV1(null, undefined, REGISTRY, 'color-slices'), fill(Model.DEFAULT_WEIGHT));
  assert.equal(View.heightToV1({ mode: 'auto' }), null);
});

test('a height v1 cannot express survives a v1 write', () => {
  assert.equal(View.heightToV1({ mode: 'px', px: 120 }), null, 'v1 has no way to write a px height');
  assert.deepEqual(View.heightFromV1(null, { mode: 'px', px: 120 }, REGISTRY, 'color-slices'), { mode: 'px', px: 120 });
  assert.deepEqual(View.heightFromV1(null, { mode: 'auto' }, REGISTRY, 'color-slices'), { mode: 'auto' });
  assert.deepEqual(View.heightFromV1(9, { mode: 'px', px: 120 }, REGISTRY, 'color-slices'), fill(9), 'a real v1 change wins');
});

test('a locked ratio round-trips through the v1 view', () => {
  assert.equal(View.heightToV1({ mode: 'ratio', ratio: 1.4 }), null, 'v1 has no weight for a ratio');
  assert.equal(View.heightRatioToV1({ mode: 'ratio', ratio: 1.4 }), 1.4);
  assert.equal(View.heightRatioToV1(fill(3)), null);
  assert.deepEqual(
    View.heightFromV1(null, { mode: 'ratio', ratio: 1.4 }, REGISTRY, 'color-slices'),
    { mode: 'ratio', ratio: 1.4 },
    'a v1 write with no ratio keeps the stored one',
  );
  const d = doc([palette([col('c1', [mod('i1', 'color-slices', { mode: 'ratio', ratio: 1.4 })])])]);
  const v1 = View.docToV1(d);
  assert.equal(v1.columns[0].modules[0].ratio, 1.4);
  const back = View.columnsFromV1(v1.columns, d.palettes[0].columns, CTX);
  assert.deepEqual(back[0].modules[0].height, { mode: 'ratio', ratio: 1.4 });
});

// --- the v1 view ----------------------------------------------------------

test('docToV1 reads the primary palette and the floats', () => {
  const d = doc([
    palette([col('c1', [mod('i1', 'color-slices', fill(3)), mod('i2', 'csp-color', { mode: 'auto' })])]),
    palette([col('f1c1', [mod('i3', 'color-slices', fill(2))])], {
      id: 'f1',
      pos: { x: 900, y: 100, displayId: null },
      size: { width: 260, height: 400 },
      snap: 'left',
      snapTo: 'p1',
    }),
  ]);
  const v1 = View.docToV1(d);
  assert.equal(v1.version, 1);
  assert.deepEqual(v1.columns.map((c) => c.id), ['c1']);
  assert.deepEqual(v1.columns[0].modules.map((m) => m.weight), [3, null]);
  assert.equal(v1.floats.length, 1);
  assert.deepEqual(
    { floatId: v1.floats[0].floatId, x: v1.floats[0].x, width: v1.floats[0].width, snap: v1.floats[0].snap },
    { floatId: 'f1', x: 900, width: 260, snap: 'left' },
  );
  assert.deepEqual(v1.floats[0].columns[0].modules.map((m) => m.weight), [2]);
});

// --- applying a v1 write --------------------------------------------------

test('a columns-only write leaves the floats alone', () => {
  const before = doc([
    palette([col('c1', [mod('i1', 'color-slices', fill(1))])]),
    palette([col('d1', [mod('i2', 'color-slices', fill(1))])], { id: 'f1' }),
  ]);
  const after = View.applyV1Doc(before, { columns: [col('c1', [vmod('i1', 'color-slices', 7)])] }, CTX);
  assert.equal(after.palettes.length, 2, 'the float survives a palette write');
  assert.deepEqual(after.palettes[0].columns[0].modules[0].height, fill(7));
});

test('a floats-only write leaves the palette columns alone', () => {
  const before = doc([
    palette([col('c1', [mod('i1', 'color-slices', fill(4))])]),
    palette([col('d1', [mod('i2', 'color-slices', fill(1))])], { id: 'f1' }),
  ]);
  const after = View.applyV1Doc(before, { floats: [{ floatId: 'f1', x: 5, y: 6, width: 200, height: 300, snap: 'right', columns: [] }] }, CTX);
  assert.deepEqual(after.palettes[0].columns[0].modules[0].height, fill(4));
  // A v1 write carries *columns only*: the workspace owns position, size, snap and collapsed, so a
  // window's own save can never push a stale position over a move the drag session just committed,
  // nor drop a join it just recorded.
  assert.equal(after.palettes[1].pos.x, before.palettes[1].pos.x);
  assert.equal(after.palettes[1].snap, before.palettes[1].snap);
  // A float the workspace has never seen is created from the v1 record — the upgrade path.
  const fresh = View.applyV1Doc(before, { floats: [{ floatId: 'f9', x: 5, y: 6, width: 200, height: 300, snap: 'right', columns: [] }] }, CTX);
  const created = fresh.palettes.find((p) => p.id === 'f9');
  assert.equal(created.pos.x, 5);
  assert.equal(created.snap, 'right');
  assert.equal(created.size.width, 200);
});

test('a palette the v1 doc does not mention is kept, not dropped', () => {
  // The reverse of the old rule. It used to be authoritative so that closing a float
  // through the v1 path removed it; floats close through `palette.close` now, and the
  // old rule lost a palette the moment one was created after the view was read (a
  // duplicate with a live window, for instance).
  const before = doc([
    palette([col('c1', [mod('i1', 'color-slices', fill(1))])]),
    palette([col('d1', [mod('i2', 'color-slices', fill(1))])], { id: 'f1' }),
    palette([col('e1', [mod('i3', 'color-slices', fill(1))])], { id: 'f2' }),
  ]);
  const after = View.applyV1Doc(before, { floats: [{ floatId: 'f2', x: 1, y: 2, width: 260, height: 260, snap: null, columns: [{ id: 'e1', width: null, modules: [{ instanceId: 'i3', moduleId: 'color-slices', weight: 1 }] }] }] }, CTX);
  assert.deepEqual(after.palettes.map((p) => p.id), ['p1', 'f2', 'f1']);
  // f1 is untouched, not blanked.
  assert.equal(after.palettes[2].columns[0].modules[0].instanceId, 'i2');
});

test('a new float becomes a palette and an unknown module is dropped', () => {
  const before = doc([palette([col('c1', [mod('i1', 'color-slices', fill(1))])])]);
  const after = View.applyV1Doc(before, {
    floats: [{ floatId: 'f9', x: 1, y: 2, width: 260, height: 300, snap: null, columns: [col('x', [vmod('i9', 'nope', 1), vmod('i8', 'color-slices', 2)])] }],
  }, CTX);
  assert.deepEqual(after.palettes.map((p) => p.id), ['p1', 'f9']);
  assert.equal(after.palettes[1].name, 'Palette 2', 'a new window is named, not anonymous');
  assert.equal(after.nextPaletteNumber, 3);
  assert.deepEqual(after.palettes[1].columns[0].modules.map((m) => m.moduleId), ['color-slices']);
  assert.equal(after.palettes[1].size.height, 300);
});

test('a later write does not rename an existing float', () => {
  const floats = [{ floatId: 'f9', x: 1, y: 2, width: 260, height: 300, snap: null, columns: [col('x', [vmod('i9', 'color-slices', 1)])] }];
  const first = View.applyV1Doc(doc([palette([col('c1', [mod('i1', 'color-slices', fill(1))])])]), { floats }, CTX);
  first.palettes[1].name = 'Notes';
  const second = View.applyV1Doc(first, { floats }, CTX);
  assert.equal(second.palettes[1].name, 'Notes');
});

test('a snapped float is anchored to the palette', () => {
  const before = doc([palette([col('c1', [mod('i1', 'color-slices', fill(1))])])]);
  const after = View.applyV1Doc(before, {
    floats: [{ floatId: 'f9', x: 1, y: 2, width: 260, height: 300, snap: 'top', columns: [col('x', [vmod('i9', 'color-slices', 1)])] }],
  }, CTX);
  assert.equal(after.palettes[1].snap, 'top');
  assert.equal(after.palettes[1].snapTo, 'p1');
});

test('a v1 write never mutates the document it was given', () => {
  const before = doc([palette([col('c1', [mod('i1', 'color-slices', fill(1))])]), palette([col('d1', [mod('i2', 'color-slices', fill(1))])], { id: 'f1' })]);
  const snapshot = JSON.stringify(before);
  View.applyV1Doc(before, { columns: [], floats: [] }, CTX);
  assert.equal(JSON.stringify(before), snapshot);
});

test('a v1 write keeps the collapse state, which v1 cannot express', () => {
  const before = doc([palette([col('c1', [mod('i1', 'color-slices', fill(1))])]), palette([col('d1', [mod('i2', 'color-slices', fill(1))])], { id: 'f1', collapsed: true })]);
  assert.equal(before.palettes[1].collapsed, true);
  // The float layer reads this to reopen a window in the state it was left.
  assert.equal(View.docToV1(before).floats[0].collapsed, true);
  // Exactly what floats.js does on a geometry change or a dock.
  const after = View.applyV1Doc(before, View.docToV1(before), CTX);
  assert.equal(after.palettes[1].collapsed, true);
});

// --- the property the whole bridge rests on -------------------------------

test('a full v1 round trip keeps a px height, an auto height and a share', () => {
  const before = doc([palette([col('c1', [
    mod('i1', 'color-slices', { mode: 'px', px: 180 }),
    mod('i2', 'csp-color', { mode: 'auto' }),
    mod('i3', 'color-slices', fill(6)),
  ])])]);
  const v1 = View.docToV1(before);
  assert.deepEqual(v1.columns[0].modules.map((m) => m.weight), [null, null, 6], 'px and auto both read as null');
  const after = View.applyV1Doc(before, v1, CTX);
  assert.deepEqual(after.palettes[0].columns[0].modules.map((m) => m.height), [
    { mode: 'px', px: 180 },
    { mode: 'auto' },
    fill(6),
  ]);
});

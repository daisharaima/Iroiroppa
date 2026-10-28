'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Model = require('../src/shared/layout-model');
// Ids for the intents that create things (duplicate, place): deterministic, so a
// failure names the same thing twice.
let seq = 0;
const newId = (prefix) => `${prefix}_t${++seq}`;

const REGISTRY = {
  'csp-color': { autoHeight: true, instanceable: false },
  'color-slices': { instanceable: true },
  'color-slider': { autoHeight: true },
};

function idGen() {
  let n = 0;
  return (prefix) => `${prefix}_n${(n += 1)}`;
}

const mod = (instanceId, moduleId, height) => ({
  instanceId,
  moduleId,
  height: height || { mode: 'fill', weight: 1 },
});
const col = (id, modules, width = null) => ({ id, width, modules });
const pal = (id, name, columns) => ({
  id,
  name,
  pos: { x: 10, y: 20, displayId: 1 },
  size: { width: 300, height: 600 },
  collapsed: false,
  snap: null,
  snapTo: null,
  columns,
});

function build(palettes) {
  return Model.normalise(
    { version: 2, palettes, nextPaletteNumber: palettes.length + 1 },
    { registry: REGISTRY, newId: idGen() },
  );
}

const OPT = { registry: REGISTRY };

/** Two palettes: p1 has two columns (two modules, then one), p2 has one. */
function base() {
  return build([
    pal('p1', 'Palette 1', [
      col('c1', [mod('i1', 'color-slices'), mod('i2', 'color-slider')]),
      col('c2', [mod('i3', 'csp-color')]),
    ]),
    pal('p2', 'Palette 2', [col('d1', [mod('i4', 'color-slices')])]),
  ]);
}

const ids = (palette) => palette.columns.map((c) => c.modules.map((m) => m.instanceId));
const names = (doc) => doc.palettes.map((p) => p.name);

// --- normalise -------------------------------------------------------------

test('normalise prunes empty columns, repairs duplicate ids and defaults the rest', () => {
  const doc = Model.normalise({
    palettes: [{
      id: 'p1',
      columns: [
        { id: 'c1', modules: [{ instanceId: 'i1', moduleId: 'color-slices' }] },
        { id: 'c2', modules: [] },
        { id: 'c1', modules: [{ instanceId: 'i1', moduleId: 'color-slider' }] },
      ],
    }],
  }, OPT);
  assert.equal(doc.version, 2);
  assert.equal(doc.palettes[0].columns.length, 2, 'the empty column is pruned');
  assert.notEqual(doc.palettes[0].columns[1].id, 'c1', 'a duplicate column id is repaired');
  assert.notEqual(
    doc.palettes[0].columns[0].modules[0].instanceId,
    doc.palettes[0].columns[1].modules[0].instanceId,
    'a duplicate instance id is repaired',
  );
  assert.equal(doc.palettes[0].name, 'Palette 1');
  assert.equal(doc.palettes[0].size.width, 300, 'a missing size gets the default');
  assert.equal(doc.nextPaletteNumber, 2);
});

test('an unknown module is dropped only when a registry is given', () => {
  const raw = { palettes: [{ columns: [{ modules: [{ moduleId: 'nope' }, { moduleId: 'color-slices' }] }] }] };
  const withRegistry = Model.normalise(raw, OPT);
  assert.deepEqual(withRegistry.palettes[0].columns[0].modules.map((m) => m.moduleId), ['color-slices']);
  const without = Model.normalise(raw);
  assert.equal(without.palettes[0].columns[0].modules.length, 2, 'without a registry nothing is assumed');
});

test('a hidden instance of a removed module is dropped with a registry', () => {
  // The removed picker modules leave their hidden instance entries behind; a module
  // that no longer exists can never be shown again, so the entry is dead weight.
  const raw = {
    palettes: [{ id: 'p1', columns: [{ id: 'c1', modules: [{ instanceId: 'i1', moduleId: 'color-slices' }] }] }],
    hiddenInstances: [
      { instanceId: 'h1', moduleId: 'color-gamut' },
      { instanceId: 'h2', moduleId: 'color-slider' },
    ],
  };
  const withRegistry = Model.normalise(raw, OPT);
  assert.deepEqual(withRegistry.hiddenInstances, [{ instanceId: 'h2', moduleId: 'color-slider' }]);
  const without = Model.normalise(raw);
  assert.equal(without.hiddenInstances.length, 2, 'without a registry nothing is assumed');
});

test('an explicit height wins over an autoHeight default', () => {
  const doc = Model.normalise({ palettes: [{ columns: [{ modules: [
    { moduleId: 'csp-color', height: { mode: 'px', px: 90 } },
    { moduleId: 'color-slider' },
    { moduleId: 'color-slices' },
  ] }] }] }, OPT);
  const heights = doc.palettes[0].columns[0].modules.map((m) => m.height.mode);
  assert.deepEqual(heights, ['px', 'auto', 'fill']);
});

test('a snapTo that does not exist clears the snap', () => {
  const doc = Model.normalise({ palettes: [{ id: 'p1', snap: 'left', snapTo: 'gone', columns: [] }] }, OPT);
  assert.equal(doc.palettes[0].snap, null);
  assert.equal(doc.palettes[0].snapTo, null);
});

test('defaultWorkspace follows the manifest order, filtered by the registry', () => {
  const doc = Model.defaultWorkspace({ registry: REGISTRY, newId: idGen() });
  assert.equal(doc.palettes.length, 1);
  assert.equal(doc.palettes[0].columns.length, 1);
  const modules = doc.palettes[0].columns[0].modules;
  // The test registry only knows these three, so the rest of DEFAULT_IDS is filtered.
  assert.deepEqual(modules.map((m) => m.moduleId), ['csp-color', 'color-slices', 'color-slider']);
  assert.deepEqual(modules.map((m) => m.height.mode), ['auto', 'fill', 'auto']);
  assert.equal(doc.nextPaletteNumber, 2);
});

test('the shipped default workspace is Session first, then the pickers and the numbers', () => {
  const Manifest = require('../src/shared/module-manifest');
  const doc = Model.defaultWorkspace({ registry: Manifest.registry(), newId: idGen() });
  assert.deepEqual(doc.palettes[0].columns[0].modules.map((m) => m.moduleId), [
    'session', 'csp-color', 'color-wheel', 'color-slices',
    'color-slider', 'color-history', 'color-stat',
  ]);
});

// --- reduce: shape of the result ------------------------------------------

test('reduce never mutates its input document', () => {
  const before = base();
  const snapshot = JSON.stringify(before);
  const out = Model.reduce(before, { type: 'palette.rename', paletteId: 'p1', name: 'Left' });
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(out.ok, true);
  assert.equal(out.doc.palettes[0].name, 'Left');
  assert.deepEqual(out.effects, []);
});

test('an unknown intent and a bad document are refused without changing anything', () => {
  const before = base();
  const unknown = Model.reduce(before, { type: 'nope' }, OPT);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'unknown-intent');
  assert.deepEqual(unknown.doc, before);
  assert.equal(Model.reduce(before, null, OPT).ok, false);
});

test('an intent that changes nothing reports a no-op', () => {
  const before = build([pal('p1', 'Palette 1', [col('c1', [mod('i1', 'color-slices')])])]);
  const out = Model.reduce(before, { type: 'palette.setCollapsed', paletteId: 'p1', collapsed: false }, OPT);
  assert.equal(out.ok, true);
  assert.equal(out.noop, true);
  assert.deepEqual(out.effects, []);
});

// --- palettes --------------------------------------------------------------

test('rename trims, caps and refuses an empty name', () => {
  const before = base();
  const ok = Model.reduce(before, { type: 'palette.rename', paletteId: 'p1', name: '  Left  ' }, OPT);
  assert.equal(ok.doc.palettes[0].name, 'Left');
  const long = Model.reduce(before, { type: 'palette.rename', paletteId: 'p1', name: 'x'.repeat(120) }, OPT);
  assert.equal(long.doc.palettes[0].name.length, Model.MAX_NAME);
  const bad = Model.reduce(before, { type: 'palette.rename', paletteId: 'p1', name: '   ' }, OPT);
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'bad-name');
  assert.deepEqual(bad.doc, before);
});

test('close removes a palette, but never the last one', () => {
  const before = base();
  const out = Model.reduce(before, { type: 'palette.close', paletteId: 'p2' }, OPT);
  assert.equal(out.ok, true);
  assert.deepEqual(out.doc.palettes.map((p) => p.id), ['p1']);
  assert.deepEqual(out.effects, [{ type: 'palette.close', paletteId: 'p2' }]);

  const single = build([pal('p1', 'Palette 1', [col('c1', [mod('i1', 'color-slices')])])]);
  const refused = Model.reduce(single, { type: 'palette.close', paletteId: 'p1' }, OPT);
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'last-palette');
});

test('create opens a named palette and bumps the counter', () => {
  const before = base();
  const out = Model.reduce(before, { type: 'palette.create', pos: { x: 700, y: 100 } }, OPT);
  assert.equal(out.ok, true);
  assert.equal(out.doc.palettes.length, 3);
  assert.equal(out.doc.palettes[2].name, 'Palette 3');
  assert.equal(out.doc.palettes[2].pos.x, 700);
  assert.equal(out.doc.nextPaletteNumber, 4);
  assert.deepEqual(out.effects, [{ type: 'palette.open', paletteId: out.doc.palettes[2].id }]);
});

test('import adds a palette with fresh ids and drops unknown modules', () => {
  const before = base();
  const out = Model.reduce(before, {
    type: 'palette.import',
    palette: {
      name: 'From file',
      columns: [
        { width: null, modules: [mod('x1', 'color-slices'), mod('x2', 'nope')] },
        { width: 200, modules: [mod('x3', 'color-slider')] },
      ],
    },
  }, { registry: REGISTRY, newId });
  assert.equal(out.ok, true);
  assert.equal(out.doc.palettes.length, 3);
  assert.deepEqual(out.doc.palettes.slice(0, 2).map((p) => p.id), ['p1', 'p2'], 'existing palettes are untouched');
  const added = out.doc.palettes[2];
  assert.equal(added.name, 'From file');
  assert.notEqual(added.id, 'p1');
  assert.deepEqual(
    added.columns.flatMap((c) => c.modules.map((m) => m.moduleId)),
    ['color-slices', 'color-slider'],
    'the unknown module is dropped',
  );
  const instanceIds = added.columns.flatMap((c) => c.modules.map((m) => m.instanceId));
  assert.equal(new Set(instanceIds).size, instanceIds.length, 'instance ids are unique');
  assert.ok(instanceIds.every((id) => id.startsWith('i_t')), 'ids are re-minted');
  assert.deepEqual(out.effects, [{ type: 'palette.open', paletteId: added.id }]);
});

test('import refuses a palette with no columns', () => {
  const before = base();
  const out = Model.reduce(before, { type: 'palette.import', palette: { name: 'x' } }, OPT);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-palette');
});

// --- locked-ratio sizing (docs/LAYOUT.md) ---------------------------------

test('a module that declares a defaultRatio gets a locked ratio height', () => {
  const REG = { 'color-slider': { defaultRatio: 0.33 } };
  const doc = Model.normalise(
    { palettes: [{ columns: [{ modules: [{ instanceId: 'i1', moduleId: 'color-slider' }] }] }] },
    { registry: REG },
  );
  assert.deepEqual(doc.palettes[0].columns[0].modules[0].height, { mode: 'ratio', ratio: 0.33 });
});

test('a stored fill adopts the module default ratio when it declares one', () => {
  const REG = { 'color-slices': { defaultRatio: 1.5 } };
  const doc = Model.normalise(
    { palettes: [{ columns: [{ modules: [
      { instanceId: 'i1', moduleId: 'color-slices', height: { mode: 'fill', weight: 42 } },
    ] }] }] },
    { registry: REG },
  );
  assert.deepEqual(doc.palettes[0].columns[0].modules[0].height, { mode: 'ratio', ratio: 1.5 });
});

test('a module without a defaultRatio keeps the fill/auto model', () => {
  const REG = { 'color-history': { autoHeight: false } };
  const doc = Model.normalise(
    { palettes: [{ columns: [{ modules: [{ instanceId: 'i1', moduleId: 'color-history' }] }] }] },
    { registry: REG },
  );
  assert.equal(doc.palettes[0].columns[0].modules[0].height.mode, 'fill');
});

test('module.setHeight sets a locked ratio and refuses an unknown instance', () => {
  const before = base();
  const out = Model.reduce(before, {
    type: 'module.setHeight',
    instanceId: 'i1',
    height: { mode: 'ratio', ratio: 2 },
  }, OPT);
  assert.equal(out.ok, true);
  assert.deepEqual(Model.instanceRef(out.doc, 'i1').module.height, { mode: 'ratio', ratio: 2 });
  const bad = Model.reduce(before, {
    type: 'module.setHeight',
    instanceId: 'nope',
    height: { mode: 'ratio', ratio: 2 },
  }, OPT);
  assert.equal(bad.error, 'unknown-instance');
});

test('setBounds takes valid numbers and refuses a nonsense size', () => {
  const before = base();
  const out = Model.reduce(before, { type: 'palette.setBounds', paletteId: 'p1', pos: { x: 5, y: 6 }, size: { width: 320, height: 700 } }, OPT);
  assert.deepEqual(out.doc.palettes[0].pos, { x: 5, y: 6, displayId: 1 });
  assert.deepEqual(out.doc.palettes[0].size, { width: 320, height: 700 });
  const bad = Model.reduce(before, { type: 'palette.setBounds', paletteId: 'p1', size: { height: 0 } }, OPT);
  assert.equal(bad.error, 'bad-size');
});

test('setSnap needs an edge, anchors to the primary palette by default, and refuses an unknown anchor', () => {
  const before = base();
  const ok = Model.reduce(before, { type: 'palette.setSnap', paletteId: 'p2', snap: 'right', snapTo: 'p1' }, OPT);
  assert.equal(ok.doc.palettes[1].snap, 'right');
  assert.equal(ok.doc.palettes[1].snapTo, 'p1');
  const defaulted = Model.reduce(before, { type: 'palette.setSnap', paletteId: 'p2', snap: 'top' }, OPT);
  assert.equal(defaulted.doc.palettes[1].snap, 'top');
  assert.equal(defaulted.doc.palettes[1].snapTo, 'p1', 'an unnamed anchor is the primary palette');
  const bad = Model.reduce(before, { type: 'palette.setSnap', paletteId: 'p2', snap: 'right', snapTo: 'gone' }, OPT);
  assert.equal(bad.error, 'unknown-snap-target');
  const cleared = Model.reduce(before, { type: 'palette.setSnap', paletteId: 'p2', snap: null }, OPT);
  assert.equal(cleared.ok, true);
  const unknown = Model.reduce(before, { type: 'palette.setSnap', paletteId: 'nope', snap: 'left' }, OPT);
  assert.equal(unknown.error, 'unknown-palette');
});

// --- modules ---------------------------------------------------------------

test('setHeight stores each mode and refuses an unknown instance', () => {
  const before = base();
  const fill = Model.reduce(before, { type: 'module.setHeight', instanceId: 'i1', height: { mode: 'fill', weight: 3 } }, OPT);
  assert.deepEqual(fill.doc.palettes[0].columns[0].modules[0].height, { mode: 'fill', weight: 3 });
  const px = Model.reduce(before, { type: 'module.setHeight', instanceId: 'i1', height: { mode: 'px', px: 120 } }, OPT);
  assert.deepEqual(px.doc.palettes[0].columns[0].modules[0].height, { mode: 'px', px: 120 });
  assert.equal(Model.reduce(before, { type: 'module.setHeight', instanceId: 'gone' }, OPT).error, 'unknown-instance');
});

test('an edge drag maps height/width to the same ratio the slider sets', () => {
  assert.equal(Model.ratioFromDrag(420, 300), 1.4);
  assert.equal(Model.ratioFromDrag(1000, 300), 2.5, 'capped at the slider maximum');
  assert.equal(Model.ratioFromDrag(2, 300, 40), 40 / 300, 'the module floor wins');
  assert.equal(Model.ratioFromDrag(1, 0), null, 'an unmeasured card has no ratio');
});

test('setWidth updates the named columns only', () => {
  const before = base();
  const out = Model.reduce(before, {
    type: 'column.setWidth',
    paletteId: 'p1',
    widths: [{ columnId: 'c1', width: 180 }, { columnId: 'c2', width: null }],
  }, OPT);
  assert.equal(out.doc.palettes[0].columns[0].width, 180);
  assert.equal(out.doc.palettes[0].columns[1].width, null);
  assert.equal(Model.reduce(before, { type: 'column.setWidth', paletteId: 'p1', widths: [{ columnId: 'gone', width: 5 }] }, OPT).error, 'unknown-column');
});

test('enable appends to the last column and respects a singleton', () => {
  const before = build([pal('p1', 'Palette 1', [col('c1', [mod('i1', 'color-slices')])])]);
  const out = Model.reduce(before, { type: 'module.enable', moduleId: 'color-slider', paletteId: 'p1' }, { ...OPT, newId: idGen() });
  assert.deepEqual(out.doc.palettes[0].columns[0].modules.map((m) => m.moduleId), ['color-slices', 'color-slider']);
  assert.equal(out.doc.palettes[0].columns[0].modules[1].height.mode, 'auto', 'an autoHeight module defaults to its content size');

  const twice = Model.reduce(before, { type: 'module.enable', moduleId: 'color-slices', paletteId: 'p1' }, { ...OPT, newId: idGen() });
  assert.equal(twice.ok, true, 'an instanceable module can be enabled more than once');

  const singleton = Model.reduce(
    build([pal('p1', 'Palette 1', [col('c1', [mod('i1', 'csp-color')])])]),
    { type: 'module.enable', moduleId: 'csp-color', paletteId: 'p1' },
    { ...OPT, newId: idGen() },
  );
  assert.equal(singleton.error, 'already-present');

  const unknown = Model.reduce(before, { type: 'module.enable', moduleId: 'nope', paletteId: 'p1' }, OPT);
  assert.equal(unknown.error, 'unknown-module');
});

test('disable removes every instance and prunes what it empties', () => {
  const before = build([
    pal('p1', 'Palette 1', [col('c1', [mod('i1', 'color-slices'), mod('i2', 'csp-color')])]),
    pal('p2', 'Palette 2', [col('d1', [mod('i3', 'csp-color')])]),
  ]);
  const out = Model.reduce(before, { type: 'module.disable', moduleId: 'csp-color' }, OPT);
  assert.equal(out.ok, true);
  assert.deepEqual(ids(out.doc.palettes[0]), [['i1']]);
  assert.deepEqual(out.doc.palettes.map((p) => p.id), ['p1'], 'the emptied palette closes');
  assert.ok(out.effects.some((e) => e.type === 'palette.close' && e.paletteId === 'p2'));
});

// --- layout.place ----------------------------------------------------------

test('a module reorders inside its own column without leaving anything behind', () => {
  const before = base();
  const out = Model.reduce(before, {
    type: 'layout.place',
    sourcePaletteId: 'p1',
    items: ['i1'],
    target: { kind: 'column', paletteId: 'p1', columnId: 'c1', index: 2 },
  }, OPT);
  assert.deepEqual(ids(out.doc.palettes[0]), [['i2', 'i1'], ['i3']]);
  assert.deepEqual(JSON.stringify(before.palettes[0]), JSON.stringify(base().palettes[0]), 'the input is untouched');
});

test('a drop back where it started is a no-op', () => {
  const before = base();
  const out = Model.reduce(before, {
    type: 'layout.place',
    sourcePaletteId: 'p1',
    items: ['i1'],
    target: { kind: 'column', paletteId: 'p1', columnId: 'c1', index: 0 },
  }, OPT);
  assert.equal(out.noop, true);
  assert.deepEqual(out.effects, []);
});

test('a module moves into another column at the index', () => {
  const before = base();
  const out = Model.reduce(before, {
    type: 'layout.place',
    sourcePaletteId: 'p1',
    items: ['i1'],
    target: { kind: 'column', paletteId: 'p1', columnId: 'c2', index: 0 },
  }, OPT);
  assert.deepEqual(ids(out.doc.palettes[0]), [['i2'], ['i1', 'i3']]);
  assert.deepEqual(out.effects, [{ type: 'palette.fit', paletteId: 'p1', change: { kind: 'module-added', py: 0, count: 1 } }]);
});

test('a drop on a seam inserts a column and asks the target to grow', () => {
  const before = base();
  const out = Model.reduce(before, {
    type: 'layout.place',
    sourcePaletteId: 'p1',
    items: ['i3'],
    width: 260,
    target: { kind: 'seam', paletteId: 'p1', seamIndex: 2 },
  }, OPT);
  assert.equal(out.doc.palettes[0].columns.length, 2, 'the emptied column is replaced by the dropped one');
  assert.deepEqual(ids(out.doc.palettes[0]), [['i1', 'i2'], ['i3']]);
  assert.equal(out.doc.palettes[0].columns[1].width, 260);
  assert.deepEqual(out.effects[0], { type: 'palette.fit', paletteId: 'p1', change: { kind: 'columns-added', px: 260 } });
});

test('a drop on the outer edge appends a column', () => {
  const before = base();
  const out = Model.reduce(before, {
    type: 'layout.place',
    sourcePaletteId: 'p1',
    items: ['i1'],
    width: 200,
    target: { kind: 'outer', paletteId: 'p1', side: 'right' },
  }, OPT);
  assert.deepEqual(ids(out.doc.palettes[0]), [['i2'], ['i3'], ['i1']]);
  assert.deepEqual(out.effects[0], { type: 'palette.fit', paletteId: 'p1', change: { kind: 'columns-added', px: 200 } });
});

test('a drop on empty space opens a new palette sized to its content', () => {
  const before = base();
  const out = Model.reduce(before, {
    type: 'layout.place',
    sourcePaletteId: 'p1',
    items: ['i1'],
    target: { kind: 'desktop', pos: { x: 900, y: 140 } },
  }, { ...OPT, newId: idGen() });
  assert.equal(out.doc.palettes.length, 3);
  const opened = out.doc.palettes[2];
  assert.equal(opened.name, 'Palette 3');
  assert.deepEqual(opened.pos, { x: 900, y: 140, displayId: null });
  assert.deepEqual(ids(opened), [['i1']]);
  assert.ok(out.effects.some((e) => e.type === 'palette.open' && e.paletteId === opened.id));
  assert.ok(out.effects.some((e) => e.type === 'palette.fit' && e.paletteId === opened.id && e.change.kind === 'content'));
});

test('a whole palette keeps its columns when it is dropped', () => {
  const before = base();
  const out = Model.reduce(before, {
    type: 'layout.place',
    sourcePaletteId: 'p1',
    grouping: 'columns',
    items: ['i1', 'i2', 'i3'],
    target: { kind: 'desktop', pos: { x: 40, y: 40 } },
  }, { ...OPT, newId: idGen() });
  assert.deepEqual(ids(out.doc.palettes[out.doc.palettes.length - 1]), [['i1', 'i2'], ['i3']]);
  assert.equal(out.doc.palettes.length, 2, 'the emptied source palette closes');
  assert.equal(out.doc.palettes[0].id, 'p2');
});

test('a palette emptied by a drop closes', () => {
  const before = base();
  const out = Model.reduce(before, {
    type: 'layout.place',
    sourcePaletteId: 'p2',
    items: ['i4'],
    target: { kind: 'column', paletteId: 'p1', columnId: 'c1', index: 1 },
  }, OPT);
  assert.deepEqual(out.doc.palettes.map((p) => p.id), ['p1']);
  assert.deepEqual(ids(out.doc.palettes[0]), [['i1', 'i4', 'i2'], ['i3']]);
  assert.ok(out.effects.some((e) => e.type === 'palette.close' && e.paletteId === 'p2'));
});

test('the last palette is never lost to a drop', () => {
  const before = build([pal('p1', 'Palette 1', [col('c1', [mod('i1', 'color-slices'), mod('i2', 'color-slider')])])]);
  const out = Model.reduce(before, {
    type: 'layout.place',
    sourcePaletteId: 'p1',
    items: ['i1'],
    target: { kind: 'outer', paletteId: 'p1', side: 'left' },
  }, { ...OPT, newId: idGen() });
  assert.equal(out.doc.palettes.length, 1);
  assert.deepEqual(ids(out.doc.palettes[0]), [['i1'], ['i2']]);
});

test('a selection may not span palettes, and unknown items are refused', () => {
  const before = base();
  const mixed = Model.reduce(before, {
    type: 'layout.place',
    sourcePaletteId: 'p1',
    items: ['i1', 'i4'],
    target: { kind: 'outer', paletteId: 'p1', side: 'right' },
  }, OPT);
  assert.equal(mixed.error, 'mixed-source');
  const unknown = Model.reduce(before, {
    type: 'layout.place',
    sourcePaletteId: 'p1',
    items: ['gone'],
    target: { kind: 'outer', paletteId: 'p1', side: 'right' },
  }, OPT);
  assert.equal(unknown.error, 'unknown-instance');
  assert.equal(Model.reduce(before, { type: 'layout.place', sourcePaletteId: 'p1', items: [], target: { kind: 'outer', paletteId: 'p1', side: 'right' } }, OPT).error, 'no-items');
});

test('a multi-selection lands as one run', () => {
  const before = base();
  const out = Model.reduce(before, {
    type: 'layout.place',
    sourcePaletteId: 'p1',
    items: ['i3', 'i1'],
    target: { kind: 'column', paletteId: 'p1', columnId: 'c1', index: 0 },
  }, OPT);
  // Document order is i1 (c1) then i3 (c2), regardless of the order in `items`.
  assert.deepEqual(ids(out.doc.palettes[0]), [['i1', 'i3', 'i2']]);
});

// --- workspace.load --------------------------------------------------------

test('duplicate makes a copy of a palette, with its own instances', () => {
  const before = base();
  const out = Model.reduce(before, { type: 'palette.duplicate', paletteId: 'p1' }, { registry: REGISTRY, newId });
  assert.equal(out.ok, true);
  assert.equal(out.doc.palettes.length, 3);
  const copy = out.doc.palettes[2];
  assert.equal(copy.name, 'Palette 1 copy');
  // Same shape and modules, new ids for the palette, its columns and its instances.
  assert.deepEqual(
    copy.columns.map((c) => c.modules.map((m) => m.moduleId)),
    before.palettes[0].columns.map((c) => c.modules.map((m) => m.moduleId)),
  );
  assert.notEqual(copy.id, 'p1');
  const sourceInstances = before.palettes[0].columns.flatMap((c) => c.modules.map((m) => m.instanceId));
  const copyInstances = copy.columns.flatMap((c) => c.modules.map((m) => m.instanceId));
  assert.equal(copyInstances.some((id) => sourceInstances.includes(id)), false);
  // Offset so it does not hide the original, on the same monitor, and free (not
  // snapped to it).
  assert.deepEqual(copy.pos, {
    x: before.palettes[0].pos.x + 24,
    y: before.palettes[0].pos.y + 24,
    displayId: before.palettes[0].pos.displayId,
  });
  assert.equal(copy.snap, null);
  // Main is told to open it.
  assert.deepEqual(out.effects, [{ type: 'palette.open', paletteId: copy.id }]);
  // The source is untouched.
  assert.deepEqual(before.palettes.map(ids), out.doc.palettes.slice(0, 2).map(ids));
});

test('duplicate refuses an unknown palette', () => {
  const out = Model.reduce(base(), { type: 'palette.duplicate', paletteId: 'nope' }, { registry: REGISTRY, newId });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'unknown-palette');
});

// --- workspace load (N3: the Layout & Workspace Manager) ----------------------

test('workspace.load replaces the document and reports the lifecycle', () => {
  const before = base();
  const other = build([pal('z', 'Fresh', [col('zc', [mod('z1', 'color-slices')])])]);
  const out = Model.reduce(before, { type: 'workspace.load', doc: other }, OPT);
  assert.equal(out.ok, true);
  assert.deepEqual(out.doc.palettes.map((p) => p.id), ['z']);
  const opened = out.effects.filter((e) => e.type === 'palette.open').map((e) => e.paletteId);
  const closed = out.effects.filter((e) => e.type === 'palette.close').map((e) => e.paletteId);
  assert.deepEqual(opened, ['z']);
  assert.deepEqual(closed.sort(), ['p1', 'p2']);
});

test('queries find an instance and count modules', () => {
  const before = base();
  assert.equal(Model.instanceRef(before, 'i3').column.id, 'c2');
  assert.equal(Model.paletteOfInstance(before, 'i4').id, 'p2');
  assert.equal(Model.moduleCount(before, 'p1'), 3);
  assert.equal(Model.totalInstances(before, 'color-slices'), 2);
  assert.equal(Model.instanceRef(before, 'gone'), null);
});

// --- document order and selection ranges (the board's shift-click rule) ------

test('documentOrder walks columns then modules, in one palette', () => {
  const before = base();
  assert.deepEqual(Model.documentOrder(before, 'p1'), ['i1', 'i2', 'i3']);
  assert.deepEqual(Model.documentOrder(before), ['i1', 'i2', 'i3']); // no id -> the primary
  assert.deepEqual(Model.documentOrder(before, 'p2'), ['i4']);
  assert.deepEqual(Model.documentOrder(before, 'nope'), []);
  // The boards hold the v1 view, not a v2 document: the order rule covers both.
  const v1 = { version: 1, columns: [{ id: 'c1', modules: [{ instanceId: 'a' }, { instanceId: 'b' }] }] };
  assert.deepEqual(Model.documentOrder(v1, 'ignored'), ['a', 'b']);
});

test('rangeBetween is inclusive and order-independent', () => {
  const order = ['i1', 'i2', 'i3', 'i4'];
  assert.deepEqual(Model.rangeBetween(order, 'i1', 'i3'), ['i1', 'i2', 'i3']);
  assert.deepEqual(Model.rangeBetween(order, 'i3', 'i1'), ['i1', 'i2', 'i3']);
  assert.deepEqual(Model.rangeBetween(order, 'i2', 'i2'), ['i2']);
  assert.deepEqual(Model.rangeBetween(order, 'i1', 'gone'), []);
  assert.deepEqual(Model.rangeBetween(null, 'i1', 'i2'), []);
});

// --- instance controls: hide / show / remove, and the supplied id (N-modules) ---------

const ENV = { registry: REGISTRY, newId };
const placedIds = (doc) => doc.palettes.flatMap((p) => p.columns.flatMap((c) => c.modules.map((m) => m.instanceId)));

test('an instance can be hidden and shown again, keeping its id — and so its settings', () => {
  let doc = Model.defaultWorkspace({ registry: REGISTRY, newId });
  const target = placedIds(doc).slice(-1)[0];
  const hidden = Model.reduce(doc, { type: 'module.hide', instanceId: target }, ENV);
  assert.equal(hidden.ok, true);
  assert.ok(!placedIds(hidden.doc).includes(target), 'hidden means mounted nowhere');
  assert.deepEqual(hidden.doc.hiddenInstances, [{ instanceId: target, moduleId: 'color-slider' }]);
  const shown = Model.reduce(hidden.doc, { type: 'module.show', instanceId: target }, ENV);
  assert.equal(shown.ok, true);
  assert.deepEqual(shown.doc.hiddenInstances, []);
  assert.ok(placedIds(shown.doc).includes(target), 'the same instance comes back');
});

test('a hidden instance survives a round trip through the document', () => {
  const doc = {
    version: 2,
    palettes: [{
      id: 'p1', name: 'Palette 1', pos: { x: 0, y: 0 }, size: { width: 300, height: 600 },
      columns: [{ id: 'c1', modules: [{ instanceId: 'i9', moduleId: 'color-slices' }] }],
    }],
    hiddenInstances: [{ instanceId: 'i8', moduleId: 'csp-color' }],
  };
  const out = Model.reduce(doc, { type: 'palette.rename', paletteId: 'p1', name: 'Renamed' }, ENV);
  assert.deepEqual(out.doc.hiddenInstances, [{ instanceId: 'i8', moduleId: 'csp-color' }]);
});

test('delete removes an instance for good, placed or hidden', () => {
  let doc = Model.defaultWorkspace({ registry: REGISTRY, newId });
  const target = placedIds(doc).slice(-1)[0];
  const hidden = Model.reduce(doc, { type: 'module.hide', instanceId: target }, ENV);
  const removed = Model.reduce(hidden.doc, { type: 'module.remove', instanceId: target }, ENV);
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.doc.hiddenInstances, []);
  assert.ok(!placedIds(removed.doc).includes(target));
});

test('the last module cannot be hidden or deleted', () => {
  const doc = {
    version: 2,
    palettes: [{
      id: 'p1', name: 'Palette 1', pos: { x: 0, y: 0 }, size: { width: 300, height: 600 },
      columns: [{ id: 'c1', modules: [{ instanceId: 'i1', moduleId: 'color-slices' }] }],
    }],
  };
  assert.equal(Model.reduce(doc, { type: 'module.hide', instanceId: 'i1' }, ENV).error, 'last-module');
  assert.equal(Model.reduce(doc, { type: 'module.remove', instanceId: 'i1' }, ENV).error, 'last-module');
});

test('a supplied instance id is honoured, and one already in use is ignored', () => {
  const doc = Model.defaultWorkspace({ registry: REGISTRY, newId });
  const out = Model.reduce(doc, { type: 'module.enable', moduleId: 'color-slices', instanceId: 'i_copy' }, ENV);
  assert.equal(out.ok, true);
  assert.ok(placedIds(out.doc).includes('i_copy'), 'main mints the id for a duplicate');
  const again = Model.reduce(out.doc, { type: 'module.enable', moduleId: 'color-slices', instanceId: 'i_copy' }, ENV);
  assert.equal(placedIds(again.doc).filter((x) => x === 'i_copy').length, 1, 'an id in use is not reused');
});

test('a one-time seed marker is recorded once, and survives the document round trip', () => {
  // The marker is what stops a seed re-adding a module the user removed (main.js seeds
  // `session` and `color-stat` into a workspace written before they existed).
  const doc = Model.defaultWorkspace({ registry: REGISTRY, newId });
  const out = Model.reduce(doc, { type: 'layout.markSeeded', key: 'one-palette' }, ENV);
  assert.equal(out.ok, true);
  assert.deepEqual(out.doc.seeded, ['one-palette']);
  const again = Model.reduce(out.doc, { type: 'layout.markSeeded', key: 'one-palette' }, ENV);
  assert.deepEqual(again.doc.seeded, ['one-palette'], 'marking twice records it once');
  const renamed = Model.reduce(out.doc, {
    type: 'palette.rename', paletteId: out.doc.palettes[0].id, name: 'Renamed',
  }, ENV);
  assert.deepEqual(renamed.doc.seeded, ['one-palette'], 'a normalise keeps it');
});

test('a module id renamed in Oct 2026 maps to the new id on read', () => {
  const legacy = {
    version: 2,
    palettes: [{ id: 'p1', columns: [{ id: 'c1', modules: [
      { instanceId: 'i1', moduleId: 'oklch-slice' },
      { instanceId: 'i2', moduleId: 'oklch-slider' },
    ] }] }],
  };
  const doc = Model.normalise(legacy, { registry: REGISTRY, newId: idGen() });
  const ids = doc.palettes[0].columns[0].modules.map((m) => m.moduleId);
  assert.deepEqual(ids, ['color-slices', 'color-slider']);
});

// --- the live-id list the trash sweep uses (docs/INVARIANTS.md) ----------------------

test('liveInstanceIds keeps placed and hidden instances, hidden included', () => {
  const doc = {
    palettes: [{ columns: [{ modules: [{ instanceId: 'p1' }, { instanceId: 'p2' }] }] }],
    hiddenInstances: [{ instanceId: 'h1', moduleId: 'session' }],
  };
  assert.deepEqual(Model.liveInstanceIds(doc).sort(), ['h1', 'p1', 'p2']);
});

test('liveInstanceIds tolerates a bare id in hiddenInstances and an empty document', () => {
  assert.deepEqual(Model.liveInstanceIds({ hiddenInstances: ['h2'] }), ['h2']);
  assert.deepEqual(Model.liveInstanceIds(null), []);
});

test('a newly enabled module can be placed as a lone column', () => {
  const before = build([pal('p1', 'Palette 1', [col('c1', [mod('i1', 'color-slices')])])]);
  const out = Model.reduce(before, {
    type: 'module.enable', moduleId: 'color-slider', paletteId: 'p1', lone: true,
  }, { ...OPT, newId: idGen() });
  assert.equal(out.ok, true);
  assert.equal(out.doc.palettes[0].columns.length, 2);
  assert.deepEqual(out.doc.palettes[0].columns[0].modules.map((m) => m.moduleId), ['color-slices']);
  assert.deepEqual(out.doc.palettes[0].columns[1].modules.map((m) => m.moduleId), ['color-slider']);
  assert.equal(out.doc.palettes[0].columns[1].width, null);
});

test('showing a hidden module as lone gives it its own column', () => {
  const before = build([pal('p1', 'Palette 1', [col('c1', [mod('i1', 'color-slices')])])]);
  before.hiddenInstances = [{ instanceId: 'i2', moduleId: 'color-slider' }];
  const out = Model.reduce(before, {
    type: 'module.show', instanceId: 'i2', paletteId: 'p1', lone: true,
  }, { ...OPT, newId: idGen() });
  assert.equal(out.ok, true);
  assert.equal(out.doc.palettes[0].columns.length, 2);
  assert.deepEqual(out.doc.palettes[0].columns[1].modules.map((m) => m.instanceId), ['i2']);
});

// --- module minimize (collapsed) -------------------------------------------

test('a module can be minimized and expanded, and the flag survives normalise', () => {
  const doc = base();
  const out = Model.reduce(doc, { type: 'module.setCollapsed', instanceId: 'i1', collapsed: true }, OPT);
  assert.equal(out.ok, true);
  const found = out.doc.palettes[0].columns[0].modules[0];
  assert.equal(found.collapsed, true);
  const again = Model.normalise(out.doc, OPT);
  assert.equal(again.palettes[0].columns[0].modules[0].collapsed, true);
  const back = Model.reduce(out.doc, { type: 'module.setCollapsed', instanceId: 'i1', collapsed: false }, OPT);
  assert.equal(back.doc.palettes[0].columns[0].modules[0].collapsed, false);
});

test('module.setCollapsed refuses an unknown instance', () => {
  const out = Model.reduce(base(), { type: 'module.setCollapsed', instanceId: 'nope', collapsed: true }, OPT);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'unknown-instance');
});

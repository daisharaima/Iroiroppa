'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createLayoutStore, migrateV1 } = require('../src/main/layout-store');

const REGISTRY = {
  'csp-color': { autoHeight: true, instanceable: false },
  'color-slices': {},
  'color-slider': { autoHeight: true },
  'color-history': {},
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'iroiroppa-layout-'));
}

/** A realistic v1 document: the palette board, a float board, and a float from
 *  before float boards existed (one bare module). */
const V1 = {
  version: 1,
  columns: [{
    id: 'c1',
    width: null,
    modules: [
      { instanceId: 'i1', moduleId: 'csp-color', weight: null },
      { instanceId: 'i2', moduleId: 'color-slices', weight: 5 },
      { instanceId: 'i3', moduleId: 'color-slider', weight: 20 },
    ],
  }],
  floats: [
    {
      floatId: 'f1',
      x: 900,
      y: 120,
      width: 260,
      height: 420,
      snap: 'left',
      columns: [{ id: 'f1c1', width: 200, modules: [{ instanceId: 'i4', moduleId: 'color-slices', weight: null }] }],
    },
    { moduleId: 'color-history', x: 5, y: 6, snap: 'top' },
  ],
};

const SETTINGS = { windowBounds: { x: 100, y: 80, width: 300, height: 640, displayId: 2 } };

const heights = (column) => column.modules.map((m) => m.height);

// --- migration -------------------------------------------------------------

test('migrateV1 turns the palette and the floats into palettes', () => {
  const doc = migrateV1(V1, SETTINGS, { registry: REGISTRY });
  assert.equal(doc.version, 2);
  assert.deepEqual(doc.palettes.map((p) => p.id), ['p1', 'f1', 'f2']);
  assert.deepEqual(doc.palettes.map((p) => p.name), ['Palette 1', 'Palette 2', 'Palette 3']);
  assert.equal(doc.nextPaletteNumber, 4);

  const primary = doc.palettes[0];
  assert.deepEqual(primary.pos, { x: 100, y: 80, displayId: 2 });
  assert.deepEqual(primary.size, { width: 300, height: 640 });
  assert.deepEqual(heights(primary.columns[0]), [
    { mode: 'auto' },                        // weight null on an autoHeight module
    { mode: 'fill', weight: 5 },
    { mode: 'fill', weight: 20 },
  ]);

  const float = doc.palettes[1];
  assert.deepEqual(float.pos, { x: 900, y: 120, displayId: null });
  assert.deepEqual(float.size, { width: 260, height: 420 });
  assert.equal(float.snap, 'left');
  assert.equal(float.snapTo, 'p1', 'a snapped float follows the palette');
  assert.equal(float.columns[0].width, 200);

  const legacy = doc.palettes[2];
  assert.equal(legacy.snap, 'top', 'all four edges are honoured now');
  assert.deepEqual(legacy.size, { width: 260, height: 260 });
  assert.deepEqual(legacy.columns[0].modules.map((m) => m.moduleId), ['color-history']);
  assert.equal(legacy.columns[0].modules[0].instanceId.length > 0, true);
});

test('migrateV1 without a registry keeps v1 weight semantics', () => {
  const doc = migrateV1(V1, SETTINGS);
  assert.deepEqual(heights(doc.palettes[0].columns[0]), [
    { mode: 'fill', weight: 17 },              // v1's DEFAULT_WEIGHT
    { mode: 'fill', weight: 5 },
    { mode: 'fill', weight: 20 },
  ]);
});

test('migrateV1 keeps a v1 locked ratio instead of dropping it to a default', () => {
  // v1 wrote a locked-ratio module's share as `ratio`, not `weight`. Reading only
  // `weight` sent every such module to its default height, so a recipe or a user's
  // saved board lost its proportions on the way into v2.
  const doc = migrateV1({
    columns: [{
      id: 'c1',
      width: null,
      modules: [
        { instanceId: 'i1', moduleId: 'color-slices', ratio: 1.9 },
        { instanceId: 'i2', moduleId: 'color-slider', ratio: 0.36 },
        { instanceId: 'i3', moduleId: 'color-history' },
      ],
    }],
    floats: [],
  }, SETTINGS, { registry: REGISTRY });
  assert.deepEqual(heights(doc.palettes[0].columns[0]), [
    { mode: 'ratio', ratio: 1.9 },
    { mode: 'ratio', ratio: 0.36 },
    { mode: 'fill', weight: 17 }, // no ratio and no weight: the module's own default
  ]);
});

test('migrateV1 reads the older windowPos/windowSize keys', () => {
  const doc = migrateV1({ columns: [], floats: [] }, { windowPos: { x: 1, y: 2 }, windowSize: { width: 250, height: 500 } });
  assert.deepEqual(doc.palettes[0].pos, { x: 1, y: 2, displayId: null });
  assert.deepEqual(doc.palettes[0].size, { width: 250, height: 500 });
  assert.equal(doc.palettes[0].columns.length, 0, 'an empty board is allowed');
});

// --- store -----------------------------------------------------------------

test('a v2 document round-trips through the store', () => {
  const dir = tempDir();
  try {
    const store = createLayoutStore(dir, { registry: REGISTRY });
    assert.equal(store.read(), null, 'nothing saved yet');
    const doc = {
      version: 2,
      palettes: [{
        id: 'p1', name: 'Left', pos: { x: 10, y: 20, displayId: 1 }, size: { width: 300, height: 600 },
        collapsed: false, snap: null, snapTo: null,
        columns: [{ id: 'c1', width: null, modules: [{ instanceId: 'i1', moduleId: 'color-slices', height: { mode: 'fill', weight: 4 } }] }],
      }],
      nextPaletteNumber: 2,
    };
    assert.equal(store.write(doc), true);
    assert.deepEqual(store.read(), store.normalise(doc));
    assert.equal(fs.existsSync(`${store.layoutFile()}.tmp`), false, 'the temp file is not left behind');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a v1 file on disk is migrated when it is read', () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify(V1));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(SETTINGS));
    const store = createLayoutStore(dir, { registry: REGISTRY });
    const doc = store.read();
    assert.equal(doc.version, 2);
    assert.deepEqual(doc.palettes.map((p) => p.id), ['p1', 'f1', 'f2']);
    assert.deepEqual(doc.palettes[0].size, { width: 300, height: 640 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown module is dropped on read only with a registry', () => {
  const dir = tempDir();
  try {
    const raw = { version: 2, palettes: [{ columns: [{ modules: [{ moduleId: 'nope' }, { moduleId: 'color-slices' }] }] }] };
    fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify(raw));
    const withRegistry = createLayoutStore(dir, { registry: REGISTRY });
    assert.deepEqual(withRegistry.read().palettes[0].columns[0].modules.map((m) => m.moduleId), ['color-slices']);
    const without = createLayoutStore(dir);
    assert.equal(without.read().palettes[0].columns[0].modules.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt document reads as null and is kept as a backup', () => {
  const dir = tempDir();
  try {
    const store = createLayoutStore(dir, { registry: REGISTRY });
    fs.writeFileSync(store.layoutFile(), '{ not json');
    assert.equal(store.read(), null);
    assert.equal(fs.readFileSync(store.backupFile(), 'utf8'), '{ not json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a document with no palettes is never written', () => {
  const dir = tempDir();
  try {
    const store = createLayoutStore(dir, { registry: REGISTRY });
    assert.equal(store.write({ version: 2, palettes: [] }), false);
    assert.equal(fs.existsSync(store.layoutFile()), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

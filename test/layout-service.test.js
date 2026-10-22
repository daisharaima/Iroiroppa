'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createLayoutService } = require('../src/main/layout-service');
const { createLayoutStore } = require('../src/main/layout-store');

const REGISTRY = {
  'csp-color': { autoHeight: true, instanceable: false },
  'color-slices': {},
  'color-slider': { autoHeight: true },
};

function idGen() {
  let n = 0;
  return (prefix) => `${prefix}_n${(n += 1)}`;
}

/** A scheduler the test fires by hand, so a debounce can be observed. */
function manualScheduler() {
  const queued = [];
  return {
    queued,
    schedule(fn) {
      queued.push(fn);
      return () => {
        const index = queued.indexOf(fn);
        if (index >= 0) queued.splice(index, 1);
      };
    },
    run() {
      for (const fn of queued.splice(0)) fn();
    },
  };
}

function fakeStore(initial) {
  const writes = [];
  return {
    writes,
    read: () => initial,
    write(next) {
      writes.push(JSON.parse(JSON.stringify(next)));
      return true;
    },
  };
}

function make(store) {
  const scheduler = manualScheduler();
  const service = createLayoutService({
    store,
    registry: REGISTRY,
    newId: idGen(),
    schedule: scheduler.schedule,
  });
  return { service, scheduler, store };
}

const columns = (weight) => [{
  id: 'c1',
  width: null,
  modules: [{ instanceId: 'i1', moduleId: 'color-slices', weight }],
}];

// --- loading ---------------------------------------------------------------

test('a first run starts from the default workspace and knows it was not stored', () => {
  const { service } = make(fakeStore(null));
  assert.equal(service.hasStoredDoc(), false);
  const doc = service.load();
  assert.equal(doc.version, 2);
  assert.equal(doc.palettes.length, 1);
  assert.equal(service.hasStoredDoc(), false, 'the default is not a stored document');
  assert.equal(service.revisions(), 0);
  assert.equal(service.v1().columns.length, 1);
});

test('a stored document is what the service serves', () => {
  const stored = {
    version: 2,
    palettes: [{
      id: 'p1', name: 'Palette 1', pos: { x: 0, y: 0, displayId: null }, size: { width: 300, height: 600 },
      collapsed: false, snap: null, snapTo: null,
      columns: [{ id: 'c1', width: null, modules: [{ instanceId: 'i1', moduleId: 'color-slices', height: { mode: 'fill', weight: 4 } }] }],
    }],
    nextPaletteNumber: 2,
  };
  const { service } = make(fakeStore(stored));
  assert.equal(service.hasStoredDoc(), true);
  assert.deepEqual(service.v1().columns[0].modules[0].weight, 4);
});

// --- writing ---------------------------------------------------------------

test('a write bumps the revision and reaches the disk once, debounced', () => {
  const { service, scheduler, store } = make(fakeStore(null));
  service.load();
  service.writeV1({ columns: columns(4) });
  service.writeV1({ columns: columns(5) });
  assert.equal(service.revisions(), 2);
  assert.equal(store.writes.length, 0, 'nothing is written until the debounce fires');
  scheduler.run();
  assert.equal(store.writes.length, 1, 'two changes coalesce into one save');
  assert.equal(store.writes[0].version, 2);
  assert.equal(service.revisions(), 2, 'the revision is not rewritten');
});

test('a write that changes nothing is a no-op', () => {
  const { service, scheduler, store } = make(fakeStore(null));
  service.load();
  service.writeV1(service.v1());
  assert.equal(service.revisions(), 0);
  assert.equal(scheduler.queued.length, 0, 'nothing to save');
  store.writes.length = 0;
  service.flush();
  assert.equal(store.writes.length, 0);
});

test('dispose flushes a pending save (the quit path)', () => {
  const { service, store } = make(fakeStore(null));
  service.load();
  service.writeV1({ columns: columns(4) });
  assert.equal(store.writes.length, 0);
  service.dispose();
  assert.equal(store.writes.length, 1);
});

// --- intents ---------------------------------------------------------------

test('an intent applies through the reducer and bumps the revision', () => {
  const { service } = make(fakeStore(null));
  service.load();
  const paletteId = service.current().palettes[0].id;
  const out = service.apply({ type: 'palette.rename', paletteId, name: 'Left' });
  assert.equal(out.ok, true);
  assert.equal(out.rev, 1);
  assert.equal(service.current().palettes[0].name, 'Left');
});

test('a rejected intent changes nothing and does not bump the revision', () => {
  const { service, store } = make(fakeStore(null));
  service.load();
  const paletteId = service.current().palettes[0].id;
  const out = service.apply({ type: 'palette.close', paletteId });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'last-palette');
  assert.equal(service.revisions(), 0);
  service.flush();
  assert.equal(store.writes.length, 0);
});

test('subscribers hear every change with its revision', () => {
  const { service } = make(fakeStore(null));
  service.load();
  const heard = [];
  const off = service.on((change) => heard.push({ rev: change.rev, kind: change.kind }));
  const paletteId = service.current().palettes[0].id;
  service.apply({ type: 'palette.rename', paletteId, name: 'A' });
  service.writeV1({ columns: columns(3) });
  assert.deepEqual(heard, [{ rev: 1, kind: 'intent' }, { rev: 2, kind: 'v1' }]);
  off();
  service.apply({ type: 'palette.rename', paletteId, name: 'B' });
  assert.equal(heard.length, 2, 'the unsubscribe took effect');
});

// --- the float layer's pattern --------------------------------------------

test('the float layer reading the document and writing it back keeps a px height', () => {
  const { service } = make(fakeStore(null));
  service.load();
  const instanceId = service.current().palettes[0].columns[0].modules[0].instanceId;
  service.apply({ type: 'module.setHeight', instanceId, height: { mode: 'px', px: 180 } });
  service.writeV1(service.v1()); // exactly what floats.js does on a geometry change
  assert.deepEqual(service.current().palettes[0].columns[0].modules[0].height, { mode: 'px', px: 180 });
});

test('findFloat reads the live document', () => {
  const { service } = make(fakeStore(null));
  service.load();
  service.writeV1({ floats: [{ floatId: 'f1', x: 5, y: 6, width: 260, height: 300, snap: null, columns: [] }] });
  assert.equal(service.findFloat('f1').x, 5);
  assert.equal(service.findFloat('nope'), null);
});

// --- end to end through the real store ------------------------------------

test('a v1 file on disk becomes a v2 workspace the service serves and writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iroiroppa-service-'));
  try {
    fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify({
      version: 1,
      columns: [{ id: 'c1', width: null, modules: [{ instanceId: 'i1', moduleId: 'color-slices', weight: 4 }] }],
      floats: [{ floatId: 'f1', x: 900, y: 120, width: 260, height: 420, snap: 'left', columns: [] }],
    }));
    const store = createLayoutStore(dir, { registry: REGISTRY });
    const { service } = make(store);
    assert.equal(service.hasStoredDoc(), true);
    assert.equal(service.current().version, 2);
    assert.deepEqual(service.v1().columns[0].modules[0].weight, 4);
    assert.equal(service.v1().floats[0].floatId, 'f1');

    service.writeV1({ columns: columns(9) });
    assert.equal(service.flush(), true);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'layout.json'), 'utf8'));
    assert.equal(saved.version, 2);
    assert.deepEqual(saved.palettes[0].columns[0].modules[0].height, { mode: 'fill', weight: 9 });
    assert.equal(saved.palettes.length, 2, 'the float entry was kept');
    assert.equal(saved.palettes[1].snap, 'left');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- per-palette columns (plan: palette equality, P2) -----------------------

test('setColumns changes only the named palette', () => {
  const { service } = make(fakeStore(null));
  const p1 = service.current().palettes[0].id;
  service.apply({ type: 'palette.duplicate', paletteId: p1 });
  const [a, b] = service.current().palettes.map((p) => p.id);
  const beforeA = JSON.stringify(service.paletteColumns(a));

  const bCols = service.paletteColumns(b);
  const v1 = bCols.map((c) => ({
    id: c.id,
    width: 222,
    modules: c.modules.map((m) => ({ instanceId: m.instanceId, moduleId: m.moduleId, weight: 33 })),
  }));
  const out = service.setColumns(b, v1);
  assert.equal(out.ok, true);
  assert.equal(JSON.stringify(service.paletteColumns(a)), beforeA, 'the other palette is untouched');
  const afterB = service.paletteColumns(b);
  assert.equal(afterB[0].width, 222);
  assert.deepEqual(afterB[0].modules[0].height, { mode: 'fill', weight: 33 });
});

test('paletteColumns and setColumns reject an unknown palette', () => {
  const { service } = make(fakeStore(null));
  assert.equal(service.paletteColumns('nope'), null);
  assert.deepEqual(service.setColumns('nope', []), { ok: false, error: 'unknown-palette' });
});

test('paletteColumns returns a copy, not the live array', () => {
  const { service } = make(fakeStore(null));
  const id = service.current().palettes[0].id;
  const cols = service.paletteColumns(id);
  cols[0].width = 9999;
  assert.notEqual(service.paletteColumns(id)[0].width, 9999, 'mutating the copy cannot change the document');
});

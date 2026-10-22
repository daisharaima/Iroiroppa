'use strict';

// Per-instance module settings (docs/LAYOUT.md, N1): a file per *instance*, falling
// back to the module's file so every pre-N1 setting carries over to the first
// instance of that module.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createModuleStore } = require('../src/main/module-store');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-mod-'));
  return { dir, store: createModuleStore(dir) };
}

test('an instance with no file of its own inherits the module settings', () => {
  const { store } = tempStore();
  store.writeModuleSettings('color-slices', { hue: 210, rings: true }, 2);
  assert.deepEqual(store.readModuleSettings('i7', 'color-slices'), { hue: 210, rings: true });
});

test('an instance file wins over the module file, and is not shared', () => {
  const { store, dir } = tempStore();
  store.writeModuleSettings('color-slices', { hue: 210 }, 2);
  store.writeModuleSettings('i7', { hue: 40 }, 2);
  assert.deepEqual(store.readModuleSettings('i7', 'color-slices'), { hue: 40 });
  // A different instance still sees the module's defaults, not i7's.
  assert.deepEqual(store.readModuleSettings('i8', 'color-slices'), { hue: 210 });
  // And the files really are separate.
  assert.equal(fs.existsSync(path.join(dir, 'modules', 'i7.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'modules', 'i8.json')), false);
});

test('nothing stored anywhere is {} — the module runs on its defaults', () => {
  const { store } = tempStore();
  assert.deepEqual(store.readModuleSettings('i9', 'color-slices'), {});
  assert.deepEqual(store.readModuleSettings('i9'), {});
});

test('a malformed file reads as empty rather than throwing, and does not shadow', () => {
  const { store, dir } = tempStore();
  fs.mkdirSync(path.join(dir, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'modules', 'i7.json'), '{ not json');
  store.writeModuleSettings('color-slices', { hue: 210 }, 2);
  // The instance's file exists but is broken: it reads empty, and we do not fall
  // through to the module (which would silently mix two sources).
  assert.deepEqual(store.readModuleSettings('i7', 'color-slices'), {});
});

test('an id that could escape the modules directory is refused', () => {
  const { store } = tempStore();
  assert.deepEqual(store.readModuleSettings('../../evil', 'color-slices'), {});
  assert.equal(store.writeModuleSettings('../evil', {}, 1), false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createModuleStore } = require('../src/main/module-store');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iroiroppa-modules-'));
  return { dir, store: createModuleStore(dir) };
}

test('listModuleIds returns the shipped selector modules', () => {
  const { dir, store } = tempStore();
  try {
    const ids = store.listModuleIds();
    assert.ok(ids.includes('csp-color'), 'csp-color is listed');
    assert.ok(ids.includes('color-slices'), 'color-slices is listed');
    assert.deepEqual([...ids], [...ids].sort(), 'sorted');
    assert.ok(ids.every((id) => !id.endsWith('.js')), 'ids have no extension');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('module settings round-trip and default to an empty object', () => {
  const { dir, store } = tempStore();
  try {
    assert.deepEqual(store.readModuleSettings('color-slider'), {}, 'missing file is empty');
    assert.equal(store.writeModuleSettings('color-slider', { showL: false, thickness: 70 }, 3), true);
    assert.deepEqual(store.readModuleSettings('color-slider'), { showL: false, thickness: 70 });
    const raw = JSON.parse(fs.readFileSync(store.moduleSettingsFile('color-slider'), 'utf8'));
    assert.equal(raw.version, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a module id is validated so it cannot escape the modules folder', () => {
  const { dir, store } = tempStore();
  try {
    assert.deepEqual(store.readModuleSettings('../settings'), {});
    assert.equal(store.writeModuleSettings('..', {}, 1), false);
    assert.equal(store.writeModuleSettings('a/b', {}, 1), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a renamed module id inherits the settings file under the old id', () => {
  const { dir, store } = tempStore();
  try {
    store.writeModuleSettings('oklch-slider', { thickness: 42 }, 3);
    // The instance has no file of its own and the new module id's file is missing,
    // so the legacy id's file is inherited.
    assert.deepEqual(store.readModuleSettings('i1', 'color-slider'), { thickness: 42 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a settings write is atomic and leaves no temp file', () => {
  const { dir, store } = tempStore();
  try {
    assert.equal(store.writeModuleSettings('csp-color', { n: 1 }, 1, 'csp-color'), true);
    const file = path.join(dir, 'modules', 'csp-color.json');
    assert.equal(fs.existsSync(`${file}.tmp`), false, 'the temp file is renamed away');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).settings, { n: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

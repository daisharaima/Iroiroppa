'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUserModuleStore } = require('../src/main/user-module-store');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-um-'));
  const um = path.join(root, 'user-modules');
  const mk = (id, files) => {
    const dir = path.join(um, id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  };
  mk('hello-module', {
    'module.js': '//x',
    'module.json': JSON.stringify({ name: 'Hello Module', group: 'picker', autoHeight: true, defaultRatio: 0.5 }),
  });
  mk('no-entry', { 'module.json': '{}' }); // no module.js -> skipped
  mk('session', { 'module.js': '//x' });   // bundled id -> refused
  mk('bad.id', { 'module.js': '//x' });    // invalid id (dot) -> refused
  mk('broken-meta', { 'module.js': '//x', 'module.json': '{ not json' }); // malformed manifest -> refused
  return {
    root,
    store: createUserModuleStore(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('list reads valid user modules and merges their metadata', () => {
  const f = fixture();
  try {
    const list = f.store.list();
    assert.deepEqual(list.map((m) => m.id), ['hello-module']);
    assert.equal(list[0].name, 'Hello Module');
    assert.equal(list[0].group, 'picker');
    assert.equal(list[0].autoHeight, true);
    assert.equal(list[0].defaultRatio, 0.5);
  } finally { f.cleanup(); }
});

test('a bundled id, a missing module.js, an invalid id and a malformed manifest are all ignored', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.store.list().map((m) => m.id), ['hello-module']);
  } finally { f.cleanup(); }
});

test('assetPath resolves inside the folder and refuses escapes', () => {
  const f = fixture();
  try {
    const p = f.store.assetPath('hello-module', 'module.js');
    assert.ok(p.endsWith(path.join('hello-module', 'module.js')));
    assert.equal(f.store.assetPath('hello-module', '../module.js'), '');
    assert.equal(f.store.assetPath('hello-module', '../../secret'), '');
    assert.equal(f.store.assetPath('session', 'module.js'), '');
    assert.equal(f.store.assetPath('nope', 'module.js'), '');
  } finally { f.cleanup(); }
});

test('an absent root is empty, never a throw', () => {
  const store = createUserModuleStore(path.join(os.tmpdir(), `iro-um-missing-${Date.now()}`));
  assert.deepEqual(store.list(), []);
  assert.equal(store.assetPath('x', 'module.js'), '');
});

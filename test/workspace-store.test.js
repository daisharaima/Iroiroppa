'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorkspaceStore } = require('../src/main/workspace-store');

const makeStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-ws-'));
  return createWorkspaceStore(() => dir);
};
const DOC = { version: 2, palettes: [{ id: 'p1', columns: [] }], floats: [] };

test('save / list / get round-trips a workspace', () => {
  const store = makeStore();
  const saved = store.save('Evening', DOC);
  assert.equal(saved.ok, true);
  assert.equal(saved.workspace.name, 'Evening');
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Evening');
  const got = store.get(saved.workspace.id);
  assert.deepEqual(got.doc, DOC);
});

test('saving the same name overwrites rather than duplicating', () => {
  const store = makeStore();
  const a = store.save('Day', DOC);
  const b = store.save('day', DOC);
  assert.equal(a.workspace.id, b.workspace.id);
  assert.equal(store.list().length, 1);
});

test('rename and remove', () => {
  const store = makeStore();
  const { workspace } = store.save('Old', DOC);
  assert.equal(store.rename(workspace.id, 'New').ok, true);
  assert.equal(store.get(workspace.id).name, 'New');
  assert.equal(store.remove(workspace.id).ok, true);
  assert.equal(store.get(workspace.id), null);
  assert.equal(store.list().length, 0);
});

test('a malformed file is skipped, not fatal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-ws-'));
  const store = createWorkspaceStore(() => dir);
  store.save('Good', DOC);
  fs.writeFileSync(path.join(dir, 'workspaces', 'broken.json'), '{ not json');
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Good');
});

test('an unknown id is null and a bad rename is reported', () => {
  const store = makeStore();
  assert.equal(store.get('nope'), null);
  assert.equal(store.remove('nope').ok, true); // force:true is idempotent
  assert.equal(store.rename('nope', 'x').ok, false);
});

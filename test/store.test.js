'use strict';

// JsonStore persists atomically (temp + rename) so a crash mid-write cannot
// truncate settings.json or history.json.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/main/store');

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-store-'));
  return path.join(dir, name);
}

test('set persists and reads back, leaving no .tmp behind', () => {
  const file = tmpFile('settings.json');
  const store = new JsonStore(file, { a: 1 });
  store.set({ b: 2 });
  assert.deepEqual(new JsonStore(file, {}).get(), { a: 1, b: 2 });
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  assert.ok(fs.existsSync(file));
});

test('a write creates its directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-store-'));
  const file = path.join(dir, 'nested', 'deep', 'x.json');
  const store = new JsonStore(file, {});
  store.set({ v: 1 });
  assert.ok(fs.existsSync(file));
});

test('replace and clear keep the file consistent', () => {
  const file = tmpFile('s.json');
  const store = new JsonStore(file, { a: 1 });
  store.replace({ c: 3 });
  assert.deepEqual(store.get(), { c: 3 });
  store.clear();
  assert.deepEqual(store.get(), { a: 1 });
});

test('a malformed file falls back to defaults without throwing', () => {
  const file = tmpFile('bad.json');
  fs.writeFileSync(file, '{ not json');
  const store = new JsonStore(file, { a: 1 });
  assert.deepEqual(store.get(), { a: 1 });
});

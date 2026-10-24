'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const log = require('../src/main/colour-log');

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-log-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('entries append as one JSON object per line', () => withDir((dir) => {
  log.init(dir);
  assert.equal(log.record({ kind: 'set', L: 0.5 }), true);
  assert.equal(log.record({ kind: 'host', rgb: { r: 1, g: 2, b: 3 } }), true);
  const lines = fs.readFileSync(path.join(dir, 'colour-log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map((l) => l.kind), ['set', 'host']);
}));

test('a new launch rotates the previous run and keeps one copy', () => withDir((dir) => {
  log.init(dir);
  log.record({ kind: 'old' });
  log.init(dir);
  log.record({ kind: 'new' });
  const cur = JSON.parse(fs.readFileSync(path.join(dir, 'colour-log.jsonl'), 'utf8').trim());
  const prev = JSON.parse(fs.readFileSync(path.join(dir, 'colour-log.jsonl.prev'), 'utf8').trim());
  assert.equal(cur.kind, 'new');
  assert.equal(prev.kind, 'old');
}));

test('the log stops at MAX_ENTRIES and marks the cut', () => withDir((dir) => {
  log.init(dir);
  for (let i = 0; i < log.MAX_ENTRIES + 5; i++) log.record({ kind: 'x', i });
  const lines = fs.readFileSync(path.join(dir, 'colour-log.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, log.MAX_ENTRIES + 1);
  assert.equal(JSON.parse(lines[lines.length - 1]).kind, 'log-full');
  assert.equal(log.record({ kind: 'after-full' }), false);
}));

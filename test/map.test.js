'use strict';

// Guards the code index an agent reads instead of whole files (docs/ARCHITECTURE.md):
// it must say how many files it saw, and `--files` must list every one of them. A
// silently skipped file is how a review ends up reporting real modules as missing.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function runMap(...args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'map.js'), ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || 'map.js exited non-zero');
  return r.stdout;
}

function jsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      jsFiles(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith('.js')) out.push(entry.name);
  }
  return out;
}

test('the index header reports every file the walk saw', () => {
  const out = runMap();
  const m = /^# (\d+) files, (\d+) indexed/.exec(out);
  assert.ok(m, 'the output must start with a "# N files, M indexed" header');
  const expected = jsFiles(path.join(ROOT, 'src')).length + jsFiles(path.join(ROOT, 'scripts')).length;
  assert.equal(Number(m[1]), expected);
  assert.ok(Number(m[2]) <= expected, 'indexed cannot exceed files');
});

test('--files lists every walked file, including those with no declarations', () => {
  const out = runMap('--files');
  const rows = out.trim().split('\n').slice(1); // the header
  assert.equal(rows.length, jsFiles(path.join(ROOT, 'src')).length + jsFiles(path.join(ROOT, 'scripts')).length);
  // Locales declare nothing, so they are exactly the files the old index dropped.
  assert.ok(rows.some((r) => r.includes('src/shared/locales/en.js')), 'a declaration-free file must still be listed');
});

test('IPC registrations are indexed even when they follow another statement', () => {
  const out = runMap();
  for (const name of ['settings:update', 'window:bounds', 'module:action']) {
    assert.ok(out.includes(name), `${name} is registered on a shared line and must appear in the index`);
  }
});

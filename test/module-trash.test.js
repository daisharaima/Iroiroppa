'use strict';

// The Trash: settings files nothing uses. Deleting a palette or an instance keeps the file that
// holds an instance's settings (a mis-click stays recoverable), so the leftovers have to be cleared
// somewhere — the Trash section does it on request, and startup sweeps the ones older than 30 days.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createModuleStore, TRASH_DAYS } = require('../src/main/module-store');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-trash-'));
  fs.mkdirSync(path.join(dir, 'modules'), { recursive: true });
  const store = createModuleStore(dir);
  const write = (id, at) => {
    const file = path.join(dir, 'modules', `${id}.json`);
    fs.writeFileSync(file, JSON.stringify({ version: 1, settings: {} }));
    if (at) fs.utimesSync(file, at, at);
  };
  return { dir, store, write, file: (id) => path.join(dir, 'modules', `${id}.json`) };
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

test('a module default and a live instance are never unused', () => {
  const s = sandbox();
  s.write('color-slices');            // a module's defaults: the manifest keeps it
  s.write('i1');                     // placed in the workspace
  s.write('i2');                     // hidden in the workspace
  s.write('i_dead');                 // nothing knows this one
  const unused = s.store.listUnused(['i1', 'i2']).map((f) => f.id);
  assert.deepEqual(unused, ['i_dead']);
});

test('the startup sweep takes only what is older than the window, the button takes the rest', () => {
  const s = sandbox();
  s.write('i_old', daysAgo(TRASH_DAYS + 1));
  s.write('i_new', daysAgo(1));
  const swept = s.store.purgeUnused([], Date.now(), TRASH_DAYS);
  assert.deepEqual(swept, ['i_old']);
  assert.equal(fs.existsSync(s.file('i_old')), false);
  assert.equal(fs.existsSync(s.file('i_new')), true);
  // The Trash section's own button removes everything unused, however recent.
  const all = s.store.purgeUnused([]);
  assert.deepEqual(all, ['i_new']);
  assert.equal(fs.existsSync(s.file('i_new')), false);
});

test('ages are reported oldest first, and a file the workspace uses is left alone', () => {
  const s = sandbox();
  s.write('i_a', daysAgo(9));
  s.write('i_b', daysAgo(3));
  s.write('i_keep', daysAgo(40));
  const files = s.store.listUnused(['i_keep']);
  assert.deepEqual(files.map((f) => f.id), ['i_a', 'i_b']);
  assert.ok(files[0].ageDays >= 8 && files[0].ageDays <= 10);
});

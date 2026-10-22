'use strict';

// Guards the "new selector module, stale docs" mistake: every module file under
// src/renderer/selector_module must be listed as a file in the layout docs, and
// the ids the renderer mounts must match the files on disk. CI runs `npm test`
// on every push and PR, so adding a module without documenting it fails there.
// See AGENTS.md → "Keeping the docs in step".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODULE_DIR = path.join(ROOT, 'src', 'renderer', 'selector_module');
const MANIFEST_PATH = path.join(ROOT, 'src', 'shared', 'module-manifest.js');
const DOCS = ['docs/ARCHITECTURE.md', 'docs/MODULES.md'];

/** Each selector module on disk: its file name and the id it registers. */
function modulesOnDisk() {
  return fs.readdirSync(MODULE_DIR)
    .filter((file) => file.endsWith('.js'))
    .map((file) => {
      const src = fs.readFileSync(path.join(MODULE_DIR, file), 'utf8');
      const m = src.match(/reg\.modules\['([^']+)'\]\s*=/);
      return { file, id: m ? m[1] : null };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** The ids the renderer mounts, from the shared manifest. */
function reportedIds() {
  return require(MANIFEST_PATH).ids().slice().sort();
}

test('every selector module file registers an id matching its name', () => {
  const mods = modulesOnDisk();
  assert.ok(mods.length > 0, 'no selector modules found');
  for (const { file, id } of mods) {
    assert.equal(
      id,
      file.replace(/\.js$/, ''),
      `${file} must register reg.modules['<id>'] with the same id as its file name`,
    );
  }
});

test('every selector module is listed in the architecture docs', () => {
  const docs = DOCS.map((doc) => ({ doc, text: fs.readFileSync(path.join(ROOT, doc), 'utf8') }));
  for (const { id } of modulesOnDisk()) {
    for (const { doc, text } of docs) {
      assert.ok(
        text.includes(`${id}.js`),
        `${doc} does not list "${id}.js" — add the module to its source layout`,
      );
    }
  }
});

test('the manifest ids match the selector modules on disk', () => {
  const ids = modulesOnDisk().map((m) => m.id).sort();
  assert.deepEqual(reportedIds(), ids);
});

test('every manifest entry agrees with the module it names', () => {
  const manifest = require(MANIFEST_PATH);
  assert.ok(manifest.MODULES.length > 0, 'the manifest is empty');
  for (const { file, id } of modulesOnDisk()) {
    const entry = manifest.get(id);
    assert.ok(entry, `${id} is missing from src/shared/module-manifest.js`);
    const src = fs.readFileSync(path.join(MODULE_DIR, file), 'utf8');
    const from = src.indexOf('reg.modules[');
    const head = src.slice(from, from + 1200);
    const name = head.match(/name:\s*'([^']+)'/);
    assert.equal(entry.name, name && name[1], `${id}'s name has drifted from ${file}`);
    assert.equal(entry.autoHeight, /autoHeight:\s*true/.test(head), `${id}'s autoHeight has drifted from ${file}`);
  }
});

test('the manifest has unique ids and a first-run board of modules that exist', () => {
  const manifest = require(MANIFEST_PATH);
  const ids = manifest.ids();
  assert.equal(new Set(ids).size, ids.length, 'a duplicate id in the manifest');
  for (const id of manifest.DEFAULT_IDS) assert.ok(manifest.has(id), `${id} is in DEFAULT_IDS but not in MODULES`);
  assert.equal(manifest.registry()['color-stat'].autoHeight, true, 'the registry is built from the manifest');
});

test('the renderer loads the manifest before it uses it', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  const manifestAt = html.indexOf('shared/module-manifest.js');
  assert.ok(manifestAt >= 0, 'index.html must load ../shared/module-manifest.js');
  assert.ok(manifestAt < html.indexOf('src="app.js"'), 'the manifest must load before app.js');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DATA_DIR, portableRoot, portableDataDir, usableDataDir } = require('../src/main/portable');

test('a dev or installed run has no portable root', () => {
  assert.equal(portableRoot({}), '');
  assert.equal(portableRoot({ PORTABLE_EXECUTABLE_DIR: '' }), '');
  assert.equal(portableRoot({ PORTABLE_EXECUTABLE_DIR: '   ' }), '');
  assert.equal(portableRoot(null), '');
  assert.equal(portableDataDir({}), '');
});

test("the portable data root is a folder beside the exe", () => {
  const exeDir = path.join(os.tmpdir(), 'iroiroppa-portable-test');
  assert.equal(portableDataDir({ PORTABLE_EXECUTABLE_DIR: exeDir }), path.join(exeDir, 'Iroiroppa Data'));
  assert.equal(portableDataDir({ PORTABLE_EXECUTABLE_DIR: exeDir }), path.join(exeDir, DATA_DIR));
});

test('a relative portable root resolves against the working directory', () => {
  const dir = portableDataDir({ PORTABLE_EXECUTABLE_DIR: 'portable-copy' });
  assert.equal(dir, path.join(process.cwd(), 'portable-copy', DATA_DIR));
});

test('a writable folder is usable and gets created', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iroiroppa-usable-'));
  const dir = path.join(root, 'deep', 'Iroiroppa Data');
  try {
    assert.equal(usableDataDir(dir), true);
    assert.equal(fs.existsSync(dir), true);
    // Nothing is left behind by the write probe.
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a folder that cannot be created is refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iroiroppa-unusable-'));
  const file = path.join(root, 'not-a-folder');
  fs.writeFileSync(file, '');
  try {
    assert.equal(usableDataDir(path.join(file, 'Iroiroppa Data')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

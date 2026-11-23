'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** The data folder's name inside the portable exe's own folder. */
const DATA_DIR = 'Iroiroppa Data';

/** The folder holding a copy of the app, or '' when this is not a portable run. */
function portableRoot(env = process.env) {
  const dir = env && env.PORTABLE_EXECUTABLE_DIR;
  if (typeof dir !== 'string' || !dir.trim()) return '';
  return path.resolve(dir);
}

/** The portable build's data root, or '' for an installed (or dev) run. */
function portableDataDir(env = process.env) {
  const root = portableRoot(env);
  return root ? path.join(root, DATA_DIR) : '';
}

/** Create `dir` and prove it is writable; false when it cannot be used. */
function usableDataDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

module.exports = { DATA_DIR, portableRoot, portableDataDir, usableDataDir };

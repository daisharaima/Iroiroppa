'use strict';

// Where a build keeps its state.
//
// The installed app uses the per-user app-data folder (`%APPDATA%\Iroiroppa`).
// A portable build is electron-builder's `portable` target: a self-extracting
// stub that unpacks the app into a temp folder and runs it from there, so
// `process.execPath` cannot say where the user put the .exe. The stub exports
// that folder as `PORTABLE_EXECUTABLE_DIR`
// (node_modules/app-builder-lib/templates/nsis/portable.nsi), so a portable
// build keeps its whole tree — settings, the saved pairing, layout, modules,
// themes, history and the Chromium caches — in one folder beside the exe.
//
// Why beside the exe: the portable build is the one you put on a stick or copy
// to another PC, and its state must travel with it. It also stops a portable
// copy from sharing (and clobbering) the installed app's data: Electron keys
// the single-instance lock on the user-data folder, so the two can run side by
// side instead of one silently deferring to the other.

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

// A portable exe may still sit in a read-only folder (a locked share, a
// Program Files copy). Creating the folder and proving it writable keeps the
// app usable there: main falls back to the usual app-data path instead of
// failing every store write.
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

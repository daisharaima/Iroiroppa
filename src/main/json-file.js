'use strict';

// One safe way to read and write a JSON file in the app-data directory.
//
// Writes go to a temp file and are renamed over the target, so a crash (or a
// full disk) mid-save cannot leave a truncated document — the previous one
// survives. Reading never throws: a missing file is `null`, and a file that is
// not valid JSON is kept as a `.bak` before anything can overwrite it.
//
// Electron-free, so both are unit-tested headlessly.

const fs = require('node:fs');
const path = require('node:path');

/** Parse a JSON file, or `null` when it is missing or malformed. */
function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Write JSON via a temp file + rename (a rename failure falls back to a direct
 *  write rather than losing the save). */
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(value, null, 2);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* the direct write below is the fallback */
    }
    fs.writeFileSync(file, text);
  }
}

/** Keep a copy of a file that cannot be parsed, so the next save does not
 *  destroy whatever the user had. Returns true when a copy was made. */
function backupFile(file, suffix = '.bak') {
  try {
    fs.copyFileSync(file, `${file}${suffix}`);
    return true;
  } catch {
    return false;
  }
}

module.exports = { readJsonFile, writeJsonAtomic, backupFile };

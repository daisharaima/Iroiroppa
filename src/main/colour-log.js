'use strict';

// A bounded JSONL log of colour-state transitions (docs/DEV.md, "Colour log").
//
// Every window sends one line per transition on `log:colour` — a committed pick,
// a value from CSP, a re-read after a profile change — never one per drag frame.
// Main owns the file so two windows cannot interleave writes. Rotated per launch:
// `colour-log.jsonl` is this run, `.prev` the one before it.

const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 4000;

let file = null;
let count = 0;
let full = false;

/** Point the log at a data folder. Safe to call once, before `ready`. */
function init(userDataDir) {
  count = 0;
  full = false;
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    file = path.join(userDataDir, 'colour-log.jsonl');
    // Keep the previous run readable; a failed rename is not worth a warning.
    try { fs.rmSync(file + '.prev', { force: true }); } catch { /* ignore */ }
    try { fs.renameSync(file, file + '.prev'); } catch { /* first run */ }
  } catch {
    file = null;
  }
}

/** Append one entry. Never throws: logging must not disturb a pick. */
function record(entry) {
  if (!file || full) return false;
  if (count >= MAX_ENTRIES) {
    full = true;
    try { fs.appendFileSync(file, JSON.stringify({ t: Date.now(), kind: 'log-full' }) + '\n'); } catch { /* ignore */ }
    return false;
  }
  try {
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    count++;
    return true;
  } catch {
    return false;
  }
}

function currentFile() {
  return file;
}

module.exports = { init, record, currentFile, MAX_ENTRIES };

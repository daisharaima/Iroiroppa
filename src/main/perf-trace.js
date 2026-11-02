'use strict';

// Frame-gap trace for a gesture (docs/PERF.md, `--perf-gaps`).
//
// The renderer samples its own animation frames while a control is dragged and
// reports the distribution on release; this module is the writer. One JSON line per
// gesture in `<userData>/perf-trace.log`, so a measurement can be compared across
// runs without screenshots or a stopwatch.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const LIMIT = 2000;

function createPerfTrace({ limit = LIMIT } = {}) {
  let file = '';
  let count = 0;
  return function trace(summary) {
    if (!summary || count >= limit) return;
    try {
      if (!file) {
        file = path.join(app.getPath('userData'), 'perf-trace.log');
        fs.writeFileSync(file, `# perf trace ${new Date().toISOString()} pid=${process.pid}\n`);
      }
      count += 1;
      fs.appendFileSync(file, `${count} ${JSON.stringify(summary)}\n`);
    } catch { /* tracing must never break the app */ }
  };
}

/** On when `--perf-gaps` is passed, or when a shell sets IRO_PERF_GAPS. */
function perfEnabled(argv = process.argv, env = process.env) {
  return argv.includes('--perf-gaps') || Boolean(env.IRO_PERF_GAPS);
}

/**
 * The window argument that tells the renderer to sample. Mirrors the existing
 * `--local-first=` convention: the preload reads its own argv.
 */
function perfWindowArgs(enabled) {
  return enabled ? ['--perf-gaps=1'] : [];
}

module.exports = { createPerfTrace, perfEnabled, perfWindowArgs, LIMIT };

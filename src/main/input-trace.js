'use strict';

// A diagnostic log for the "painted but inert" report: the palette keeps painting
// (so its renderer is alive) and the cursor still changes on hover, yet no click or
// drag reaches it. `--trace-input` records what the pages actually receive, plus
// what a probe at the window's centre hits, so we can tell
//
//   the event never reached the page   (window / Chromium / OS input layer), from
//   the page got it and swallowed it   (a stuck pointer capture, an overlay),
//
// instead of guessing. It is off unless asked for: the palette gains nothing from a
// file of pointer chatter on a normal run.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const LIMIT = 6000;

/**
 * Append records to `<userData>/input-trace.log`. Synchronous on purpose: the log
 * has to survive the crash or hang we are chasing, so it must be on disk before the
 * next event. Capped so one long session stays readable.
 */
function createInputTrace({ limit = LIMIT } = {}) {
  let file = '';
  let count = 0;
  return function trace(rec) {
    if (!rec || count >= limit) return;
    try {
      if (!file) {
        file = path.join(app.getPath('userData'), 'input-trace.log');
        fs.writeFileSync(file, `# input trace ${new Date().toISOString()} pid=${process.pid}\n`);
      }
      count += 1;
      fs.appendFileSync(file, `${count} ${JSON.stringify(rec)}\n`);
    } catch { /* tracing must never break the app */ }
  };
}

/** On when `--trace-input` is passed, or when a shell sets IRO_TRACE_INPUT. */
function traceEnabled(argv = process.argv, env = process.env) {
  return argv.includes('--trace-input') || Boolean(env.IRO_TRACE_INPUT);
}

module.exports = { createInputTrace, traceEnabled, LIMIT };

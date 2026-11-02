'use strict';

// End-to-end tests for the native host binary itself (src/main/native/irohost.cs).
//
// The supervisor has unit tests against a fake child; this file exercises the real
// process: it starts it, speaks the protocol, and checks the replies and the exit.
// It skips (visibly) when the binary has not been built, so a checkout without the
// in-box C# compiler still passes the suite.
//
// Nothing here installs a global hook on purpose: `key <vk>` with a valid key would
// take over that key system-wide for the duration of the test run.

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { outFile } = require('../scripts/build-host.js');

const available = fs.existsSync(outFile);

/** Start the host and collect its stdout lines. */
function startHost(args = []) {
  const child = spawn(outFile, ['--parent', String(process.pid), ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const lines = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) lines.push(JSON.parse(line));
    }
  });
  const send = (line) => child.stdin.write(`${line}\n`);
  const waitFor = (predicate, timeoutMs = 3000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = lines.find(predicate);
      if (found) { clearInterval(timer); resolve(found); return; }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timed out; saw ${JSON.stringify(lines)}`));
      }
    }, 10);
  });
  const stop = () => new Promise((resolve) => {
    child.once('exit', () => resolve());
    try { send('quit'); } catch { /* already gone */ }
    setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve(); }, 1500);
  });
  return { child, lines, send, waitFor, stop };
}

test('the host answers the protocol end to end', { skip: !available && 'irohost.exe not built' }, async () => {
  const started = Date.now();
  const host = startHost();
  try {
    const ready = await host.waitFor((line) => line.ready !== undefined);
    const readyMs = Date.now() - started;
    assert.ok(readyMs < 500, `ready after ${readyMs} ms`);
    assert.equal(ready.version, '1.0.0');

    host.send('ping');
    const pong = await host.waitFor((line) => line.pong !== undefined);
    assert.ok(Number.isFinite(pong.pong));

    host.send('version');
    const version = await host.waitFor((line) => line.version !== undefined);
    assert.equal(version.version, '1.0.0');

    // `topmost` / `state` against a handle that is not a window must report, not throw.
    host.send('topmost 0');
    const topmost = await host.waitFor((line) => line.topmost !== undefined);
    assert.equal(topmost.topmost, 0);
    assert.equal(topmost.error, 'not-a-window');

    host.send('state 0');
    const state = await host.waitFor((line) => line.state !== undefined);
    assert.equal(state.state, 0);

    // An invalid vk is refused before any hook is installed.
    host.send('key 0');
    const badKey = await host.waitFor((line) => typeof line.error === 'string' && line.error.includes('vk'));
    assert.match(String(badKey.error), /vk/);

    host.send('nonsense');
    const unknown = await host.waitFor((line) => line.cmd === 'nonsense');
    assert.equal(unknown.error, 'unknown');
  } finally {
    await host.stop();
  }
});

test('the host exits on quit and reports bye', { skip: !available && 'irohost.exe not built' }, async () => {
  const host = startHost();
  await host.waitFor((line) => line.ready !== undefined);
  await host.stop();
  assert.ok(host.lines.some((line) => line.bye !== undefined), 'bye line');
});

test('the host exits when its parent is gone', { skip: !available && 'irohost.exe not built' }, async () => {
  // The parent handle is the second signal after stdin EOF; this exercises the case
  // where the pipe outlives the parent (a child elsewhere inherited it).
  const parent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  const child = spawn(outFile, ['--parent', String(parent.pid)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  await new Promise((resolve) => {
    child.stdout.setEncoding('utf8');
    child.stdout.once('data', resolve);
  });
  parent.kill();
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
  try { child.kill(); } catch { /* already gone */ }
  assert.ok(exited, 'host exited after its parent died');
});

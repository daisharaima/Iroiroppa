'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { NativeHost } = require('../src/main/native-host.js');

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = { written: [], write(line) { this.written.push(line); return true; } };
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

function makeHost(t, spawnImpl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'irohost-fail-'));
  const exe = path.join(dir, 'irohost.exe');
  fs.writeFileSync(exe, '');
  const host = new NativeHost({ exePath: exe, spawn: spawnImpl, log: null });
  t.after(() => {
    host.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return host;
}

test('a host that never reports ready is reported as not ready', async (t) => {
  const child = fakeChild();
  const host = makeHost(t, () => child);
  host.start();

  const ready = await host.whenReady(120);
  assert.equal(ready, false);
  assert.equal(host.available, false);
  assert.match(host.describe(), /native host/);
});

test('a hook that fails to install is surfaced, not waited on forever', async (t) => {
  const child = fakeChild();
  const host = makeHost(t, () => child);
  host.start();
  child.stdout.emit('data', '{"ready":1}\n');

  const seen = [];
  host.on('hook', (message) => seen.push(message));
  child.stdout.emit('data', '{"hook":0,"t":5}\n');

  assert.equal(seen.length, 1);
  assert.equal(seen[0].hook, 0);
  assert.equal(host.available, true, 'the host itself is still up');
});

test('a restart spawns a new child after the backoff, and recovers', async (t) => {
  const children = [];
  const host = makeHost(t, () => {
    const child = fakeChild();
    children.push(child);
    return child;
  });

  host.start();
  assert.equal(children.length, 1);
  children[0].stdout.emit('data', '{"ready":1}\n');
  children[0].emit('exit', 1, null);

  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(children.length, 2, 'a second child was spawned');
  children[1].stdout.emit('data', '{"ready":2}\n');
  assert.equal(host.available, true);

});

test('after giving up, further exits do not spin', async (t) => {
  const children = [];
  const host = makeHost(t, () => {
    const child = fakeChild();
    children.push(child);
    return child;
  });
  host.start();
  children[0].stdout.emit('data', '{"ready":1}\n');

  host.restarts = 7;
  children[0].emit('exit', 1, null);

  const spawned = children.length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(children.length, spawned, 'no new child after the table is exhausted');
  assert.match(host.describe(), /gave up restarting|native host/);
});

test('stopping during a pending restart does not restart', async (t) => {
  const children = [];
  const host = makeHost(t, () => {
    const child = fakeChild();
    children.push(child);
    return child;
  });
  host.start();
  children[0].stdout.emit('data', '{"ready":1}\n');
  children[0].emit('exit', 1, null);
  host.stop();

  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(children.length, 1);
});

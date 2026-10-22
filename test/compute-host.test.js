'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createComputeHost } = require('../src/main/compute-host');
const Compute = require('../src/shared/compute-protocol');

/** A fake utilityProcess: replies to every request on the next tick. */
function fakeFork(onRequest) {
  const child = new EventEmitter();
  child.postMessage = (msg) => { setImmediate(() => onRequest(child, msg)); };
  child.kill = () => { child.killed = true; child.emit('exit', 0); };
  return child;
}

test('a request resolves with the worker reply', async () => {
  const host = createComputeHost({
    workerPath: '/x.js',
    fork: () => fakeFork((child, msg) => child.emit('message', Compute.createReply(msg.id, true, `ok:${msg.type}`, null))),
  });
  assert.equal(await host.request('qr-decode', { width: 1 }), 'ok:qr-decode');
  assert.equal(host.isRunning(), true);
});

test('a worker error becomes a rejection', async () => {
  const host = createComputeHost({
    workerPath: '/x.js',
    fork: () => fakeFork((child, msg) => child.emit('message', Compute.createReply(msg.id, false, null, 'boom'))),
  });
  await assert.rejects(() => host.request('qr-decode', {}), /boom/);
});

test('a request times out and clears its slot', async () => {
  const host = createComputeHost({ workerPath: '/x.js', timeoutMs: 20, fork: () => fakeFork(() => {}) });
  await assert.rejects(() => host.request('slow', {}), /timed out/);
  assert.equal(host._pending.size, 0);
});

test('a worker exit rejects everything in flight', async () => {
  const child = new EventEmitter();
  child.postMessage = () => {};
  child.kill = () => {};
  const host = createComputeHost({ workerPath: '/x.js', fork: () => child });
  const p = host.request('qr-decode', {});
  child.emit('exit', 1);
  await assert.rejects(() => p, /compute host exited/);
  assert.equal(host.isRunning(), false);
});

test('dispose kills the child and rejects pending work', async () => {
  const child = new EventEmitter();
  child.postMessage = () => {};
  child.kill = () => { child.killed = true; };
  const host = createComputeHost({ workerPath: '/x.js', fork: () => child });
  const p = host.request('qr-decode', {});
  host.dispose();
  assert.equal(child.killed, true);
  await assert.rejects(() => p, /disposed/);
});

test('onEvent reports the host up on fork and down on exit', () => {
  const events = [];
  const child = new EventEmitter();
  child.postMessage = () => {};
  child.kill = () => {};
  const host = createComputeHost({
    workerPath: '/x.js',
    fork: () => child,
    onEvent: (type, info) => events.push([type, info]),
  });
  host.request('x', {}).catch(() => {});
  assert.deepEqual(events, [['up', { pid: child.pid }]]);
  child.emit('exit', 3);
  assert.deepEqual(events[1], ['down', { code: 3 }]);
});

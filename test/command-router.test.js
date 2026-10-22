'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommandRouter } = require('../src/main/command-router');

test('routes a call to the window that mounts the instance', async () => {
  const sent = [];
  const r = createCommandRouter({ send: (wcId, channel, payload) => sent.push({ wcId, channel, payload }) });
  r.register(11, { i1: ['reset'] });
  const p = r.call({ target: 'i1', command: 'reset', args: [3] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].wcId, 11);
  assert.equal(sent[0].channel, 'module:command:invoke');
  assert.deepEqual(sent[0].payload, { callId: sent[0].payload.callId, target: 'i1', command: 'reset', args: [3] });
  r.settle({ callId: sent[0].payload.callId, ok: true, value: 42 });
  assert.equal(await p, 42);
});

test('rejects a call to an unknown instance', async () => {
  const r = createCommandRouter({ send: () => {} });
  await assert.rejects(() => r.call({ target: 'nope', command: 'x' }), /no window mounts "nope"/);
});

test('propagates a target error as a rejection', async () => {
  const sent = [];
  const r = createCommandRouter({ send: (_w, _c, payload) => sent.push(payload) });
  r.register(7, { i2: ['boom'] });
  const p = r.call({ target: 'i2', command: 'boom' });
  r.settle({ callId: sent[0].callId, ok: false, error: 'kaboom' });
  await assert.rejects(() => p, /kaboom/);
});

test('a re-register replaces the window, and unregister drops it', () => {
  const r = createCommandRouter({ send: () => {} });
  r.register(1, { i1: ['a'] });
  r.register(2, { i1: ['b'] });
  assert.deepEqual(r.list(), { i1: ['b'] });
  r.unregister(2);
  assert.deepEqual(r.list(), {});
});

test('a timeout settles the call', async () => {
  const r = createCommandRouter({ send: () => {}, timeoutMs: 20 });
  r.register(1, { i1: ['slow'] });
  await assert.rejects(() => r.call({ target: 'i1', command: 'slow' }), /timed out/);
  assert.equal(r._pending.size, 0);
});

test('settling an unknown callId is ignored', () => {
  const r = createCommandRouter({ send: () => {} });
  assert.equal(r.settle({ callId: 999, ok: true }), false);
});

test('list reports command names per instance', () => {
  const r = createCommandRouter({ send: () => {} });
  r.register(1, { i1: ['a', 'b'], i2: [] });
  assert.deepEqual(r.list(), { i1: ['a', 'b'], i2: [] });
});

test('a stale unregister must not drop an instance another window re-registered', () => {
  const r = createCommandRouter({ send: () => {} });
  r.register(1, { i1: ['a'] });
  r.register(2, { i1: ['b'] });   // the float took it over
  r.unregister(1);                // the old window's teardown arrives late
  assert.deepEqual(r.list(), { i1: ['b'] }, 'the live owner keeps the instance');
  r.unregister(2);
  assert.deepEqual(r.list(), {});
});

test('only the window a call was sent to may settle it', async () => {
  const sent = [];
  const r = createCommandRouter({ send: (_w, _c, payload) => sent.push(payload) });
  r.register(7, { i1: ['reset'] });
  const p = r.call({ target: 'i1', command: 'reset' });
  assert.equal(r.settle({ callId: sent[0].callId, ok: true, value: 1 }, 8), false, 'forged reply ignored');
  assert.equal(r.settle({ callId: sent[0].callId, ok: true, value: 2 }, 7), true);
  assert.equal(await p, 2);
});

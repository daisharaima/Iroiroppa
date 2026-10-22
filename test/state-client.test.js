'use strict';

// The renderer state client is browser code: it reads `window`/`window.csp`. Node
// gives it a faked global so the mirror/dispatch half is unit-tested headlessly,
// the same way command-bus.test.js tests the bus.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'src', 'renderer', 'kernel', 'state-client.js');

function load({ mode = 'model' } = {}) {
  const calls = { intents: [], snapshot: { version: 1, domains: { connection: { rev: 1, value: { state: 'idle' } } } } };
  const win = {
    csp: {
      stateMode: mode,
      onStateChanged: (cb) => { calls.changeCb = cb; return () => { calls.changeCb = null; }; },
      stateSnapshot: () => Promise.resolve(calls.snapshot),
      intent: (name, payload) => { calls.intents.push({ name, payload }); return Promise.resolve({ ok: true }); },
    },
    Iro: {},
  };
  global.window = win;
  delete require.cache[require.resolve(FILE)];
  require(FILE);
  return { state: win.Iro.state, calls };
}

test('a registered adapter is called when its domain changes', () => {
  const { state, calls } = load();
  const seen = [];
  state.register('connection', (v, rev) => seen.push([v, rev]));
  calls.changeCb({ domain: 'connection', rev: 2, value: { state: 'connected' } });
  assert.deepEqual(seen, [[{ state: 'connected' }, 2]]);
});

test('registering after a value is known replays it immediately', () => {
  const { state, calls } = load();
  calls.changeCb({ domain: 'capabilities', rev: 1, value: { companion: { available: true } } });
  const seen = [];
  state.register('capabilities', (v) => seen.push(v));
  assert.deepEqual(seen, [{ companion: { available: true } }]);
  assert.deepEqual(state.value('capabilities'), { companion: { available: true } });
});

test('an unrelated domain does not wake another adapter', () => {
  const { state, calls } = load();
  const seen = [];
  state.register('history', () => seen.push('history'));
  calls.changeCb({ domain: 'connection', rev: 1, value: {} });
  assert.deepEqual(seen, []);
});

test('register returns an unsubscribe that stops delivery', () => {
  const { state, calls } = load();
  const seen = [];
  const off = state.register('connection', () => seen.push(1));
  off();
  calls.changeCb({ domain: 'connection', rev: 1, value: {} });
  assert.deepEqual(seen, []);
});

test('intent delegates to the preload', async () => {
  const { state, calls } = load();
  await state.intent('layout.set', { a: 1 });
  assert.deepEqual(calls.intents, [{ name: 'layout.set', payload: { a: 1 } }]);
});

test('hydrate applies the whole envelope', async () => {
  const { state } = load();
  await state.hydrate();
  assert.deepEqual(state.value('connection'), { state: 'idle' });
  assert.equal(state.rev('connection'), 1);
});

test('legacy mode does not subscribe to state changes', () => {
  const { calls } = load({ mode: 'legacy' });
  assert.equal(calls.changeCb, undefined);
});

test('a delta that raced ahead of the snapshot is not clobbered by it', async () => {
  const { state, calls } = load();
  calls.changeCb({ domain: 'history', rev: 5, value: ['new'] });
  calls.snapshot = { version: 1, domains: { history: { rev: 5, value: ['stale'] } } };
  await state.hydrate();
  assert.deepEqual(state.value('history'), ['new']);
  assert.equal(state.rev('history'), 5);
});

test('a higher-rev snapshot entry still applies', async () => {
  const { state, calls } = load();
  calls.changeCb({ domain: 'history', rev: 2, value: ['a'] });
  calls.snapshot = { version: 1, domains: { history: { rev: 4, value: ['b'] } } };
  await state.hydrate();
  assert.deepEqual(state.value('history'), ['b']);
  assert.equal(state.rev('history'), 4);
});

test('a lower-rev delta is ignored', () => {
  const { state, calls } = load();
  calls.changeCb({ domain: 'connection', rev: 5, value: { state: 'x' } });
  calls.changeCb({ domain: 'connection', rev: 3, value: { state: 'y' } });
  assert.deepEqual(state.value('connection'), { state: 'x' });
  assert.equal(state.rev('connection'), 5);
});

test('a change with no rev applies and bumps the local revision', () => {
  const { state, calls } = load();
  calls.changeCb({ domain: 'capabilities', value: { a: 1 } });
  calls.changeCb({ domain: 'capabilities', value: { a: 2 } });
  assert.deepEqual(state.value('capabilities'), { a: 2 });
  assert.equal(state.rev('capabilities'), 2);
});

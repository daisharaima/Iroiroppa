'use strict';

// The kernel command bus (src/renderer/kernel/command-bus.js) is browser code: it
// reads `window` and `window.csp`. Node gives it a minimal global `window` so the
// local-dispatch half is unit-tested headlessly; the cross-window half is the
// router's (test/command-router.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'src', 'renderer', 'kernel', 'command-bus.js');

function loadBus() {
  const calls = { register: [], results: [], relay: null };
  const win = {
    csp: {
      commandRegister: (t) => calls.register.push(t),
      commandCall: (...a) => { calls.relay = a; return Promise.resolve('relayed'); },
      commandResult: (...a) => calls.results.push(a),
      listCommands: () => ({ i1: ['a'] }),
      onCommandInvoke: (cb) => { calls.invokeCb = cb; },
    },
    Iro: {},
  };
  global.window = win;
  delete require.cache[require.resolve(FILE)];
  require(FILE);
  return { bus: win.Iro.commands, calls };
}

test('a local command runs here and returns its value with the arguments', async () => {
  const { bus } = loadBus();
  bus.registerLocal('i1', { add: (a, b) => a + b });
  assert.equal(await bus.call('i1', 'add', [2, 3]), 5);
});

test('a local command that throws rejects instead of leaking', async () => {
  const { bus } = loadBus();
  bus.registerLocal('i1', { boom: () => { throw new Error('kaboom'); } });
  await assert.rejects(() => bus.call('i1', 'boom'), /kaboom/);
});

test('an unknown local target falls through to the cross-window relay', async () => {
  const { bus, calls } = loadBus();
  assert.equal(await bus.call('nope', 'x', []), 'relayed');
  assert.deepEqual(calls.relay, ['nope', 'x', []]);
});

test('unregisterLocal removes the handler, so the call relays again', async () => {
  const { bus } = loadBus();
  bus.registerLocal('i1', { add: () => 1 });
  bus.unregisterLocal('i1');
  assert.equal(await bus.call('i1', 'add', []), 'relayed');
});

test('handleInvoke runs a local command and posts its result', async () => {
  const { bus, calls } = loadBus();
  bus.registerLocal('i1', { greet: () => 'hi' });
  await bus.handleInvoke({ callId: 7, target: 'i1', command: 'greet', args: [] });
  assert.deepEqual(calls.results.at(-1), [7, true, 'hi', null]);
});

test('handleInvoke reports failure for an unknown target', async () => {
  const { bus, calls } = loadBus();
  await bus.handleInvoke({ callId: 8, target: 'nope', command: 'x' });
  const [callId, ok, value, error] = calls.results.at(-1);
  assert.equal(callId, 8);
  assert.equal(ok, false);
  assert.equal(value, null);
  assert.match(error, /no instance/);
});

test('list() delegates to the bridge', async () => {
  const { bus } = loadBus();
  assert.deepEqual(await bus.list(), { i1: ['a'] });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIpcTransport } = require('../src/main/transports/ipc-transport');

/** A tiny manual clock so the lifecycle is deterministic (no real timers). */
function fakeClock() {
  let id = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) { const h = ++id; timers.set(h, { fn, ms }); return h; },
    clearTimeout(h) { timers.delete(h); },
    runNext() {
      const first = timers.entries().next();
      if (first.done) return false;
      const [h, t] = first.value;
      timers.delete(h);
      t.fn();
      return true;
    },
    pending() { return [...timers.values()].map((t) => t.ms); },
  };
}

function harness(opts = {}) {
  const sent = [];
  const clock = fakeClock();
  const transport = createIpcTransport({ send: (c, p) => sent.push({ c, p }), clock, ...opts });
  return { sent, clock, transport };
}

test('connect sends a hello and ack completes the handshake', () => {
  const { sent, transport } = harness();
  const opens = [];
  transport.onOpen((e) => opens.push(e));
  assert.equal(transport.connect(), true);
  assert.equal(transport.state(), 'connecting');
  assert.deepEqual(sent.map((s) => s.c), ['peer:hello']);
  assert.equal(transport.ack(), true);
  assert.equal(transport.isConnected(), true);
  assert.equal(opens.length, 1);
});

test('a handshake timeout closes and schedules a reconnect', () => {
  const { clock, transport } = harness({ timeoutMs: 5000 });
  const closes = [];
  transport.onClose((e) => closes.push(e.reason));
  transport.connect();
  assert.ok(clock.pending().includes(5000)); // the handshake timer
  clock.runNext(); // fire it
  assert.equal(transport.isConnected(), false);
  assert.deepEqual(closes, ['handshake timeout']);
  assert.ok(clock.pending().length >= 1); // a reconnect is scheduled (not manual)
});

test('a silent peer is reaped after maxMissed keepalives', () => {
  const { sent, clock, transport } = harness({ keepaliveMs: 100, maxMissed: 2 });
  const closes = [];
  transport.onClose((e) => closes.push(e.reason));
  transport.connect();
  transport.ack();
  sent.length = 0;
  clock.runNext(); // keepalive 1 -> ping, missed 1
  clock.runNext(); // keepalive 2 -> ping, missed 2
  assert.equal(sent.filter((s) => s.c === 'peer:ping').length, 2);
  clock.runNext(); // keepalive 3 -> missed 3 > maxMissed -> reap
  assert.deepEqual(closes, ['unresponsive']);
  assert.equal(transport.isConnected(), false);
});

test('a pong resets the missed count', () => {
  const { clock, transport } = harness({ keepaliveMs: 100, maxMissed: 2 });
  transport.connect();
  transport.ack();
  clock.runNext(); // missed 1
  assert.equal(transport.stats().missed, 1);
  transport.pong();
  assert.equal(transport.stats().missed, 0);
});

test('a manual disconnect never reconnects', () => {
  const { clock, transport } = harness({ timeoutMs: 5000 });
  transport.connect();
  transport.disconnect();
  assert.equal(clock.pending().length, 0); // timers cleared
  assert.equal(transport.connect(), false); // manual guard
  assert.equal(transport.stats().manual, true);
  transport.reset();
  assert.equal(transport.connect(), true); // allowed again after reset
});

test('send only works while connected, and receive routes messages', () => {
  const { sent, transport } = harness();
  assert.equal(transport.send({ hi: 1 }), false); // not connected yet
  transport.connect();
  transport.ack();
  assert.equal(transport.send({ hi: 2 }), true); // connected now, so it sends
  const messages = [];
  transport.onMessage((m) => messages.push(m));
  transport.receive({ type: 'sync', payload: 1 });
  transport.receive({ type: 'welcome' }); // handled internally
  assert.deepEqual(messages, [{ type: 'sync', payload: 1 }]);
  assert.deepEqual(sent.map((s) => s.c), ['peer:hello', 'peer:message']);
});

test('the reconnect backoff doubles and is capped', () => {
  const { clock, transport } = harness({ timeoutMs: 10, backoff: { min: 100, max: 300 } });
  const delays = [];
  transport.connect();          // handshake timer (10)
  for (let i = 0; i < 4; i += 1) {
    clock.runNext();            // fire the handshake timer -> drop + schedule reconnect
    delays.push(clock.pending()[0]); // the reconnect delay
    clock.runNext();            // fire the reconnect -> connect() again
  }
  assert.deepEqual(delays, [100, 200, 300, 300]);
});

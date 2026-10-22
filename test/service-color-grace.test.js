'use strict';

// The colour echo/grace rule (docs/INVARIANTS.md).
//
// A write must survive a lagging read-back, but a *real* CSP change (an
// eyedropper, a slot switch) inside the grace window must still come through.
// The service suppresses an echo only when it matches the value we wrote or the
// value we replaced — never by time alone.

const test = require('node:test');
const assert = require('node:assert/strict');
const { CompanionService } = require('../src/main/service');

function makeService() {
  const settings = { get: () => ({}), set: () => ({}) };
  const session = { get: () => ({}), replace: () => ({}), clear: () => ({}) };
  const svc = new CompanionService({ settings, session });
  const sent = [];
  svc.client = {
    alive: true,
    setColorRgb: (r, g, b) => { sent.push([r, g, b]); return Promise.resolve(); },
    close: () => {},
  };
  const emitted = [];
  svc.on('color', (c) => emitted.push(c));
  return { svc, sent, emitted };
}

test('an echo of our own write is absorbed (no emit, no re-send)', () => {
  const { svc, sent, emitted } = makeService();
  svc.writeColor({ r: 10, g: 20, b: 30 }, { immediate: true });
  svc._suppressUntil = 0; // past the "don't fight our write" window, inside the grace
  emitted.length = 0; // ignore the write's own reflection
  svc._emitIfChanged({ rgb: { r: 10, g: 20, b: 30 }, transparent: false });
  assert.equal(emitted.length, 0, 'our own value is not a change');
  assert.equal(svc._written, null, 'the grace window closes on confirmation');
  assert.deepEqual(sent, [[10, 20, 30]], 'nothing was re-sent');
});

test('an echo of the value we replaced is lag: our value is re-asserted', () => {
  const { svc, sent, emitted } = makeService();
  svc.lastColor = { rgb: { r: 1, g: 2, b: 3 }, transparent: false, active: 'main' };
  svc.writeColor({ r: 10, g: 20, b: 30 }, { immediate: true });
  svc._suppressUntil = 0;
  emitted.length = 0;
  svc._emitIfChanged({ rgb: { r: 1, g: 2, b: 3 }, transparent: false });
  assert.deepEqual(sent, [[10, 20, 30], [10, 20, 30]], 'our value is re-asserted');
  assert.equal(emitted.length, 0, 'the stale value is not shown');
  assert.ok(svc._written, 'the grace window stays open');
});

test('a matching echo tolerates the 1/255 quantisation', () => {
  const { svc, emitted } = makeService();
  svc.writeColor({ r: 10, g: 20, b: 30 }, { immediate: true });
  svc._suppressUntil = 0;
  emitted.length = 0;
  svc._emitIfChanged({ rgb: { r: 11, g: 19, b: 30 }, transparent: false });
  assert.equal(emitted.length, 0);
  assert.equal(svc._written, null);
});

test('a value matching neither ours nor the replaced one is a real change', () => {
  const { svc, sent, emitted } = makeService();
  svc.lastColor = { rgb: { r: 1, g: 2, b: 3 }, transparent: false, active: 'main' };
  svc.writeColor({ r: 10, g: 20, b: 30 }, { immediate: true });
  svc._suppressUntil = 0;
  emitted.length = 0;
  svc._emitIfChanged({ rgb: { r: 200, g: 100, b: 50 }, transparent: false });
  assert.equal(emitted.length, 1, 'the external change is emitted');
  assert.equal(emitted[0].rgb.r, 200);
  assert.equal(svc._written, null, 'the grace window is abandoned');
  assert.equal(svc._burstBase, null);
  assert.deepEqual(sent, [[10, 20, 30]], 'nothing extra was sent');
});

test('past the window an echo is never suppressed', () => {
  const { svc, emitted } = makeService();
  svc.writeColor({ r: 10, g: 20, b: 30 }, { immediate: true });
  svc._suppressUntil = 0;
  svc._written.until = Date.now() - 1; // the grace window has expired
  emitted.length = 0;
  svc._emitIfChanged({ rgb: { r: 1, g: 2, b: 3 }, transparent: false });
  assert.equal(emitted.length, 1, 'an expired window suppresses nothing');
});

test('writeColor with immediate flushes synchronously', () => {
  const { svc, sent } = makeService();
  svc.writeColor({ r: 5, g: 6, b: 7 }, { immediate: true });
  assert.deepEqual(sent, [[5, 6, 7]]);
  assert.equal(svc._written.r, 5);
  assert.equal(svc._written.g, 6);
  assert.equal(svc._written.b, 7);
});

test('_teardown clears the grace window', async () => {
  const { svc } = makeService();
  svc.writeColor({ r: 5, g: 6, b: 7 }, { immediate: true });
  assert.ok(svc._written);
  await svc._teardown();
  assert.equal(svc._written, null);
  assert.equal(svc._burstBase, null);
  assert.deepEqual(svc._recentWrites, []);
});

test('an echo of an earlier write in the same burst is ignored', () => {
  const { svc, sent, emitted } = makeService();
  svc.lastColor = { rgb: { r: 1, g: 2, b: 3 }, transparent: false, active: 'main' };
  svc.writeColor({ r: 10, g: 20, b: 30 }, { immediate: true });
  svc.writeColor({ r: 40, g: 50, b: 60 }, { immediate: true });
  svc._suppressUntil = 0;
  emitted.length = 0;
  svc._emitIfChanged({ rgb: { r: 10, g: 20, b: 30 }, transparent: false });
  assert.equal(emitted.length, 0, 'an earlier write of ours is not shown');
  assert.deepEqual(sent, [[10, 20, 30], [40, 50, 60]], 'no extra re-send for a mid-burst echo');
  assert.ok(svc._written, 'the burst stays open');
});

test('a new burst after confirmation gets a fresh base', () => {
  const { svc } = makeService();
  svc.lastColor = { rgb: { r: 1, g: 2, b: 3 }, transparent: false, active: 'main' };
  svc.writeColor({ r: 10, g: 20, b: 30 }, { immediate: true });
  assert.deepEqual(svc._burstBase, { r: 1, g: 2, b: 3 });
  svc._suppressUntil = 0;
  svc._emitIfChanged({ rgb: { r: 10, g: 20, b: 30 }, transparent: false }); // confirmed
  svc.lastColor = { rgb: { r: 7, g: 7, b: 7 }, transparent: false, active: 'main' };
  svc.writeColor({ r: 80, g: 90, b: 100 }, { immediate: true });
  assert.deepEqual(svc._burstBase, { r: 7, g: 7, b: 7 }, 'the base is the value before this burst');
});

test('an expired window clears the burst before classifying the next value', () => {
  const { svc, emitted } = makeService();
  svc.writeColor({ r: 10, g: 20, b: 30 }, { immediate: true });
  svc._suppressUntil = 0;
  svc._written.until = Date.now() - 1;
  emitted.length = 0;
  svc._emitIfChanged({ rgb: { r: 200, g: 100, b: 50 }, transparent: false });
  assert.equal(emitted.length, 1, 'the change comes through');
  assert.equal(svc._written, null);
  assert.equal(svc._burstBase, null);
  assert.deepEqual(svc._recentWrites, []);
});

test('a poll response older than a host push is discarded', async () => {
  const { svc, emitted } = makeService();
  let resolveRead;
  svc.client.readColor = () => new Promise((r) => { resolveRead = r; });
  const poll = svc._pollOnce();
  // The host push is newer than the read that was already in flight.
  svc._hostColorSeq += 1;
  svc._emitIfChanged({ rgb: { r: 20, g: 20, b: 20 }, active: 'main' });
  resolveRead({ rgb: { r: 10, g: 10, b: 10 }, active: 'main' });
  await poll;
  assert.deepEqual(emitted.map((c) => c.rgb), [{ r: 20, g: 20, b: 20 }],
    'the stale poll must not overwrite the newer host colour');
});

test('a partial update with a new active slot emits that slot RGB', () => {
  const { svc, emitted } = makeService();
  svc.lastColor = {
    main: { rgb: { r: 1, g: 1, b: 1 } },
    sub: null,
    active: 'main',
    rgb: { r: 1, g: 1, b: 1 },
  };
  svc._emitIfChanged({ main: { rgb: { r: 20, g: 20, b: 20 } }, active: 'main' });
  assert.deepEqual(emitted.at(-1).rgb, { r: 20, g: 20, b: 20 },
    'the active slot is the pick, not the merged previous rgb');
  assert.equal(emitted.at(-1).rgbFresh, true);
});

test('a partial update of only the inactive slot is not a fresh pick', () => {
  const { svc, emitted } = makeService();
  svc.lastColor = {
    main: { rgb: { r: 1, g: 1, b: 1 } },
    sub: { rgb: { r: 2, g: 2, b: 2 } },
    active: 'main',
    rgb: { r: 1, g: 1, b: 1 },
  };
  svc._emitIfChanged({ sub: { rgb: { r: 30, g: 30, b: 30 } } });
  assert.deepEqual(emitted.at(-1).rgb, { r: 1, g: 1, b: 1 });
  assert.equal(emitted.at(-1).rgbFresh, false);
});

test('an active-slot switch emits the switched slot RGB as fresh', () => {
  const { svc, emitted } = makeService();
  svc.lastColor = {
    main: { rgb: { r: 1, g: 1, b: 1 } },
    sub: { rgb: { r: 2, g: 2, b: 2 } },
    active: 'main',
    rgb: { r: 1, g: 1, b: 1 },
  };
  svc._emitIfChanged({ active: 'sub' });
  assert.deepEqual(emitted.at(-1).rgb, { r: 2, g: 2, b: 2 });
  assert.equal(emitted.at(-1).rgbFresh, true);
});

test('a poll that reverts to the colour we just changed from is lag, not a pick', () => {
  const { svc, emitted } = makeService();
  svc.lastColor = {
    main: { rgb: { r: 1, g: 2, b: 3 } },
    sub: null,
    active: 'main',
    rgb: { r: 1, g: 2, b: 3 },
  };
  svc._emitIfChanged({ rgb: { r: 20, g: 30, b: 40 }, active: 'main' });
  svc._emitIfChanged({ rgb: { r: 1, g: 2, b: 3 }, active: 'main' }, { fromPoll: true });
  assert.deepEqual(emitted.map((c) => c.rgb), [{ r: 20, g: 30, b: 40 }],
    'the lagging previous colour must not overwrite the new pick');
});

test('a real poll revert is accepted after two consecutive polls', () => {
  const { svc, emitted } = makeService();
  svc.lastColor = {
    main: { rgb: { r: 1, g: 2, b: 3 } },
    sub: null,
    active: 'main',
    rgb: { r: 1, g: 2, b: 3 },
  };
  const a = { rgb: { r: 1, g: 2, b: 3 }, active: 'main' };
  svc._emitIfChanged({ rgb: { r: 20, g: 30, b: 40 }, active: 'main' });
  svc._emitIfChanged(a, { fromPoll: true });
  assert.equal(emitted.length, 1, 'one lagging poll is ignored');
  svc._emitIfChanged(a, { fromPoll: true });
  assert.deepEqual(emitted.at(-1).rgb, { r: 1, g: 2, b: 3 },
    'a persistent revert is accepted on the second poll');
});

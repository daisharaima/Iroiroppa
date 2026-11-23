'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createQuickState } = require('../src/main/quick-state');

/** A reader that records what it was asked and answers with a scripted state. */
function reader(answer = { ok: true, on: ['a'], disabled: [] }) {
  const asked = [];
  const fn = async (names) => {
    asked.push(names.slice());
    return typeof answer === 'function' ? answer(names) : answer;
  };
  fn.asked = asked;
  return fn;
}

test('one tick asks about the union of every subscriber', async () => {
  const read = reader();
  const qs = createQuickState({ read, intervalMs: 100000 });
  qs.watch('m1', ['toolpressuretosize', 'toolbrushusewateredge']);
  qs.watch('m2', ['toolpressuretosize', 'toolcompositemultiply']);
  await qs.poll();
  assert.deepEqual(read.asked.at(-1).sort(), ['toolbrushusewateredge', 'toolcompositemultiply', 'toolpressuretosize']);
  qs.stop();
});

test('nothing watched and nothing remembered means no poll', async () => {
  const read = reader();
  const qs = createQuickState({ read, intervalMs: 100000 });
  assert.deepEqual(qs.names(), []);
  await qs.poll();
  assert.equal(read.asked.length, 0, 'an unasked question costs nothing');
  qs.stop();
});

test('the last names survive the last subscriber leaving', async () => {
  const read = reader();
  const qs = createQuickState({ read, intervalMs: 100000 });
  qs.watch('m1', ['toolpressuretosize']);
  await qs.poll();
  qs.unwatch('m1');
  assert.deepEqual(qs.names(), ['toolpressuretosize'], 'kept in memory so the mute outlives the module');
  const before = read.asked.length;
  await qs.poll();
  assert.equal(read.asked.length, before + 1, 'it keeps polling what it last knew about');
  qs.forget();
  assert.deepEqual(qs.names(), [], 'a disconnect forgets');
  qs.stop();
});

test('nothing on and something disabled is reported busy, and clears again', async () => {
  const seen = [];
  let answer = { ok: true, on: ['toolpressuretosize'], disabled: [] };
  const qs = createQuickState({
    read: async () => answer,
    onBusy: (v) => seen.push(v),
    intervalMs: 100000,
  });
  qs.watch('m1', ['toolpressuretosize']);
  await qs.poll();
  assert.equal(qs.isBusy(), false);

  answer = { ok: true, on: [], disabled: ['toolpressuretosize'] };
  await qs.poll();
  assert.equal(qs.isBusy(), true);

  answer = { ok: true, on: ['toolpressuretosize'], disabled: [] };
  await qs.poll();
  assert.equal(qs.isBusy(), false);
  assert.deepEqual(seen, [true, false], 'the hook is told both ways');
  qs.stop();
});

test('a failed read is stale, not "CSP is free"', async () => {
  const qs = createQuickState({ read: async () => ({ ok: false, error: 'not connected' }), intervalMs: 100000 });
  qs.watch('m1', ['toolpressuretosize']);
  await qs.poll();
  assert.equal(qs.state().ok, false);
  assert.equal(qs.isBusy(), false, 'a stale answer must not keep the mute on for ever');
  qs.stop();
});

test('a subscriber with no names unsubscribes rather than asking for nothing', () => {
  const qs = createQuickState({ read: async () => ({ ok: true, on: [], disabled: [] }), intervalMs: 100000 });
  qs.watch('m1', []);
  assert.deepEqual(qs.names(), []);
  qs.stop();
});

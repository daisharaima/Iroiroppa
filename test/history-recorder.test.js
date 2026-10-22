'use strict';

// Main's history recorder is the one writer of the shared list. The fallback
// settle keeps non-pointer picks to one tile; a pointer up in CSP commits the
// freshly read colour and takes over the tile the settle may already have added
// for that gesture, so a drag still ends with one tile showing the last colour
// (docs/INVARIANTS.md).

const test = require('node:test');
const assert = require('node:assert');
const { createHistoryRecorder } = require('../src/main/history-recorder');

const rgb = (r, g, b) => ({ r, g, b });

function makeRecorder({ max = 100 } = {}) {
  let list = [];
  let saved = 0;
  let broadcasts = 0;
  let timerFn = null;
  const rec = createHistoryRecorder({
    list: () => list,
    max,
    save: () => { saved += 1; },
    broadcast: () => { broadcasts += 1; },
    settleMs: 450,
    setTimer: (fn) => { timerFn = fn; return 1; },
    clearTimer: () => { timerFn = null; },
  });
  const fire = () => { const fn = timerFn; timerFn = null; if (fn) fn(); };
  return { rec, fire, list: () => list, counts: () => ({ saved, broadcasts }) };
}

test('a host pick is added by the fallback settle', () => {
  const h = makeRecorder();
  h.rec.observe(rgb(1, 2, 3));
  assert.deepEqual(h.list(), []);
  h.fire();
  assert.deepEqual(h.list(), [rgb(1, 2, 3)]);
  assert.deepEqual(h.counts(), { saved: 1, broadcasts: 1 });
});

test('note keeps a pick pending with no timer and no add', () => {
  const h = makeRecorder();
  h.rec.note(rgb(4, 5, 6));
  assert.deepEqual(h.list(), []);
  assert.deepEqual(h.rec.pending(), rgb(4, 5, 6));
  h.fire(); // no timer was installed
  assert.deepEqual(h.list(), []);
  h.rec.commit(rgb(4, 5, 6));
  assert.deepEqual(h.list(), [rgb(4, 5, 6)]);
  assert.equal(h.rec.pending(), null);
});

test('a burst settles to its last colour, not every intermediate one', () => {
  const h = makeRecorder();
  h.rec.observe(rgb(1, 2, 3));
  h.rec.observe(rgb(4, 5, 6));
  h.fire();
  assert.deepEqual(h.list(), [rgb(4, 5, 6)]);
  assert.deepEqual(h.counts(), { saved: 1, broadcasts: 1 });
});

test('a pointer-up commit before the settle adds the freshly read colour', () => {
  const h = makeRecorder();
  h.rec.observe(rgb(1, 2, 3)); // a drag is in progress
  h.rec.commit(rgb(7, 8, 9), { replaceHostHead: true }); // read taken at the up
  h.fire(); // the cancelled settle must add nothing
  assert.deepEqual(h.list(), [rgb(7, 8, 9)]);
  assert.deepEqual(h.counts(), { saved: 1, broadcasts: 1 });
});

test('a pointer-up commit takes over a tile the settle already added', () => {
  const h = makeRecorder();
  h.rec.observe(rgb(1, 2, 3));
  h.fire(); // the user paused mid-drag, so the fallback added a tile
  h.rec.observe(rgb(4, 5, 6));
  h.rec.commit(rgb(7, 8, 9), { replaceHostHead: true }); // the up's fresh read
  h.fire();
  assert.deepEqual(h.list(), [rgb(7, 8, 9)]);
});

test('an explicit commit adds a tile and ends any gesture', () => {
  const h = makeRecorder();
  h.rec.observe(rgb(1, 2, 3));
  h.rec.commit(rgb(9, 8, 7)); // no replaceHostHead: an explicit Iroiroppa pick
  h.fire();
  assert.deepEqual(h.list(), [rgb(9, 8, 7)]);
});

test('an explicit commit after a settle does not rewrite that tile', () => {
  const h = makeRecorder();
  h.rec.observe(rgb(1, 2, 3));
  h.fire();
  h.rec.commit(rgb(9, 8, 7));
  assert.deepEqual(h.list(), [rgb(9, 8, 7), rgb(1, 2, 3)]);
});

test('a colour equal to the head does not add or broadcast', () => {
  const h = makeRecorder();
  h.rec.commit(rgb(1, 2, 3));
  h.rec.commit(rgb(1, 2, 3));
  assert.deepEqual(h.list(), [rgb(1, 2, 3)]);
  assert.deepEqual(h.counts(), { saved: 1, broadcasts: 1 });
});

test('the list is capped, newest first', () => {
  const h = makeRecorder({ max: 2 });
  h.rec.commit(rgb(1, 1, 1));
  h.rec.commit(rgb(2, 2, 2));
  h.rec.commit(rgb(3, 3, 3));
  assert.deepEqual(h.list(), [rgb(3, 3, 3), rgb(2, 2, 2)]);
});

test('an invalid colour is ignored', () => {
  const h = makeRecorder();
  h.rec.observe({ r: NaN, g: 0, b: 0 });
  h.fire();
  assert.deepEqual(h.list(), []);
  assert.deepEqual(h.counts(), { saved: 0, broadcasts: 0 });
  assert.equal(h.rec.commit(null), false);
});

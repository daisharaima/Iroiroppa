'use strict';

// Host colours are recorded by main (src/main/history-recorder.js); a window's
// ColorStore only mirrors the shared list and records its own explicit picks.
// This file is the guard against a second per-window writer coming back: two
// stores with their own settle timers (a palette and a hidden float) are what
// let an older pick land after a newer one (docs/INVARIANTS.md).

const test = require('node:test');
const assert = require('node:assert');
const Color = require('../src/shared/color');

const FILE = '../src/renderer/kernel/color-store.js';
function loadStore(csp = {}) {
  global.window = { Color };
  delete require.cache[require.resolve(FILE)];
  require(FILE);
  return new window.Iro.ColorStore({ csp: { pushHistory() {}, selectSlot() {}, ...csp } });
}
const rgb = (r, g, b) => ({ r, g, b });

test('an incoming colour never writes the shared history (main is the writer)', async () => {
  const pushed = [];
  const store = loadStore({ pushHistory: (c) => pushed.push(c) });
  store.applyIncoming({ active: 'main', main: { rgb: rgb(10, 20, 30) }, rgb: rgb(10, 20, 30) });
  store.applyIncoming({ active: 'main', main: { rgb: rgb(40, 50, 60) }, rgb: rgb(40, 50, 60) });
  await new Promise((r) => setTimeout(r, 500)); // past the old 450 ms settle
  assert.deepEqual(store.history, []);
  assert.deepEqual(pushed, []);
});

test('a committed pick records once and pushes it to main', () => {
  const pushed = [];
  const store = loadStore({ pushHistory: (c) => pushed.push(c) });
  store.setLCH({ L: 0.6, C: 0.1, H: 30 }, { notify: 'commit' });
  assert.equal(store.history.length, 1);
  assert.deepEqual(pushed, [store.history[0]]);
});

test('re-selecting a recorded colour moves it to the head', () => {
  const pushed = [];
  const store = loadStore({ pushHistory: (c) => pushed.push(c) });
  store.setHistory([rgb(1, 2, 3), rgb(4, 5, 6)]);
  store.applyRecordedRgb(rgb(4, 5, 6));
  store.push(true);
  assert.equal(store.history.length, 3);
  assert.deepEqual(store.history[0], store.lastStored);
  assert.deepEqual(pushed, [store.lastStored]);
});

test('setHistory mirrors main, head first, capped at 100', () => {
  const store = loadStore();
  const list = Array.from({ length: 105 }, (_, i) => rgb(i, i + 1, i + 2));
  store.setHistory(list);
  assert.equal(store.history.length, 100);
  assert.deepEqual(store.history[0], rgb(0, 1, 2));
});

test('a committed pick de-duplicates against the head', () => {
  const pushed = [];
  const store = loadStore({ pushHistory: (c) => pushed.push(c) });
  store.setLCH({ L: 0.6, C: 0.1, H: 30 }, { notify: 'commit' });
  store.setLCH({ L: 0.6, C: 0.1, H: 30 }, { notify: 'commit' });
  assert.equal(store.history.length, 1);
  assert.equal(pushed.length, 1);
});

test('the drawing-only gate pushes an explicit pick but adds no local tile', () => {
  const pushed = [];
  const store = loadStore({ pushHistory: (c) => pushed.push(c) });
  store.historyGate = true;
  store.setLCH({ L: 0.6, C: 0.1, H: 30 }, { notify: 'commit' });
  assert.deepEqual(store.history, []);
  assert.deepEqual(pushed, [store.lastStored], 'main still learns the pending pick');
});

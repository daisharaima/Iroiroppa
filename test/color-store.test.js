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

test('a sibling preview applies exact OKLab without writing or recording', () => {
  const writes = [];
  const store = loadStore({ writeColor: (...a) => writes.push(a) });
  store.applyPreview({ lab: { L: 0.42, a: 0.03, b: -0.04 } });
  assert.ok(Math.abs(store.L - 0.42) < 1e-12);
  assert.ok(Math.abs(store.a - 0.03) < 1e-12);
  assert.ok(Math.abs(store.b + 0.04) < 1e-12);
  assert.equal(store.history.length, 0);
  assert.deepEqual(writes, []);
});

test('local changes coalesce into at most one preview frame', async () => {
  const previews = [];
  const store = loadStore({ previewColor: (lab) => previews.push(lab) });
  store.setLCH({ L: 0.6, C: 0.1, H: 30 }, { notify: 'live' });
  store.setLCH({ L: 0.61, C: 0.1, H: 30 }, { notify: 'live' });
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(previews.length, 1);
  assert.ok(Math.abs(previews[0].L - 0.61) < 1e-12);
});

test('a commit cancels a queued preview so it cannot overwrite the final value', async () => {
  const previews = [];
  const store = loadStore({ previewColor: (lab) => previews.push(lab) });
  store.setLCH({ L: 0.6, C: 0.1, H: 30 }, { notify: 'live' });
  store.push(true);
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(previews.length, 0);
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

// --- our own write comes back through the service broadcast ---------------------

test('the echo of our own write does not move the colour', () => {
  const store = loadStore();
  store.setLCH({ L: 0.6, C: 0.02, H: 250 }, { notify: 'commit' });
  const rec = { ...store.lastStored };
  const before = store.lch();
  store.applyIncoming({ active: 'main', main: { rgb: rec }, rgb: rec });
  const after = store.lch();
  assert.ok(Math.abs(after.H - before.H) < 1e-9, `H must stay ${before.H}, got ${after.H}`);
  assert.ok(Math.abs(after.C - before.C) < 1e-9);
  assert.deepEqual(store.lastStored, rec);
});

test('a genuinely different host colour is still applied', () => {
  const store = loadStore();
  store.setLCH({ L: 0.6, C: 0.02, H: 250 }, { notify: 'commit' });
  const before = store.lch().H;
  const rec = { r: 10, g: 200, b: 30 };
  store.applyIncoming({ active: 'main', main: { rgb: rec }, rgb: rec });
  assert.ok(Math.abs(store.lch().H - before) > 5, 'the host colour wins');
});

// --- a sibling palette's preview stream is a gesture --------------------------

test('a preview makes the window interactive, then settles', async () => {
  const store = loadStore();
  assert.equal(store.interactive, false);
  store.applyPreview({ lab: { L: 0.5, a: 0.02, b: -0.03 } });
  assert.equal(store.interactive, true, 'the stream marks a gesture in flight');
  assert.equal(store.dragging, false, 'a preview is not a local drag');
  await new Promise((r) => setTimeout(r, 260));
  assert.equal(store.interactive, false, 'the stream has ended');
});

test('a preview never writes, records or suppresses a local drag state', () => {
  const writes = [];
  const pushed = [];
  const store = loadStore({ writeColor: (rgb) => writes.push(rgb), pushHistory: (c) => pushed.push(c) });
  store.applyPreview({ lab: { L: 0.5, a: 0.02, b: -0.03 } });
  assert.deepEqual(writes, []);
  assert.deepEqual(pushed, []);
  assert.equal(store.dragging, false);
  // A local drag still ignores an incoming preview, and `interactive` stays true.
  store.dragging = true;
  const before = store.lch();
  store.applyPreview({ lab: { L: 0.9, a: 0, b: 0 } });
  assert.deepEqual(store.lch(), before);
  assert.equal(store.interactive, true);
});

// --- the hue anchor can be named (a grey still carries a hue) ----------------

test('setLab can name the hue of a grey, so the Wheel ring can turn it', () => {
  const store = loadStore();
  store.setLCH({ L: 0.5, C: 0, H: 10 }, { notify: 'none' });
  assert.equal(store.H, 10);
  store.setLab({ L: 0.5, a: 0, b: 0 }, { hue: 200 });
  assert.equal(store.H, 200, 'a grey keeps the hue it was turned to');
  assert.ok(store.C < 1e-9, 'the colour itself is still grey');
  store.setLab({ L: 0.5, a: 0, b: 0 });
  assert.equal(store.H, 200, 'without a name the anchor is preserved');
});

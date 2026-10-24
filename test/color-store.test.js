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

// --- the picker is sRGB; the profile only converts read/write -------------

const A = rgb(236, 165, 130);                       // #ECA582, the record
const B = Color.rgbToOklch(255 / 255, 167 / 255, 129 / 255); // #FFA781, its AdobeRGB appearance

/** A stand-in for Proof.createProof(adobeRgb, 'working'). */
function fakeProof(over = {}) {
  return {
    model: 'working',
    inGamut: () => true,
    maxChroma: () => 0.4,
    chromaIntervals: () => [[0, 0.4]],
    reduceChroma: (L, C) => C,
    chromaAxis: () => 0.5,
    readOklch: () => ({ ...B }),
    writeSrgb: () => [A.r / 255, A.g / 255, A.b / 255],
    ...over,
  };
}

function loadProvenStore(proof, csp = {}) {
  const written = [];
  const store = loadStore({ writeColor: (c) => written.push(c), ...csp });
  store.mode = 'proof';
  store.proof = proof;
  store.connected = true;
  return { store, written };
}

test('a CSP colour becomes its appearance, once, and is not written back', () => {
  const { store, written } = loadProvenStore(fakeProof());
  store.applyIncoming({ active: 'main', main: { rgb: A }, rgb: A });
  const lch = store.lch();
  assert.ok(Math.abs(lch.L - B.L) < 1e-9, 'the active value is the appearance B');
  assert.ok(Math.abs(lch.C - B.C) < 1e-9);
  assert.deepEqual(store.lastStored, A, 'the record is kept as it came');
  assert.equal(store.contentHex(), '#ECA582', 'the record round-trips back to A');
  assert.deepEqual(written, [], 'an inbound colour never pushes a write');
});

test('the picker gamut stays sRGB while a wide document profile is active', () => {
  const { store } = loadProvenStore(fakeProof());
  assert.equal(store.cmax(), 0.4);
  assert.equal(store.inGamut(0.6, 0.5, 150), Color.inGamut(0.6, 0.5, 150));
  assert.deepEqual(store.chromaIntervals(0.6, 150), Color.chromaIntervals(0.6, 150));
  assert.equal(store.maxChroma(0.6, 150), Color.maxChroma(0.6, 150));
});

test('a recorded appearance outside sRGB is not snapped by the picker', () => {
  const { store } = loadProvenStore(fakeProof()); // document gamut says "inside"
  store.setLCH({ L: 0.6, C: 0.45, H: 150 }, { snap: true });
  assert.ok(Math.abs(store.lch().C - 0.45) < 1e-9, 'the document gamut wins for a record');
});

test('a value outside the document gamut still snaps to it', () => {
  const { store } = loadProvenStore(fakeProof({ inGamut: () => false, reduceChroma: () => 0.3 }));
  store.setLCH({ L: 0.6, C: 0.45, H: 150 }, { snap: true });
  assert.ok(Math.abs(store.lch().C - 0.3) < 1e-9);
});

test('a picker snap never uses the document gamut', () => {
  const { store } = loadProvenStore(fakeProof({ inGamut: () => false, reduceChroma: () => 0.01 }));
  store.setLCH({ L: 0.6, C: 0.45, H: 150 }, { snap: true, gamut: 'picker' });
  const expected = Color.reduceChroma(0.6, 0.45, 150);
  assert.ok(Math.abs(store.lch().C - expected) < 1e-6, 'the sRGB boundary, not the document one');
});

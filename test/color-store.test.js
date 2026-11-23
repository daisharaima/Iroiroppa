'use strict';

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
  await new Promise((r) => setTimeout(r, 500));
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

  store.dragging = true;
  const before = store.lch();
  store.applyPreview({ lab: { L: 0.9, a: 0, b: 0 } });
  assert.deepEqual(store.lch(), before);
  assert.equal(store.interactive, true);
});

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

test('the 8-bit echo of our own write keeps the derived colour', () => {
  const store = loadStore();
  store.setLCH({ L: 0.62, C: 0.08, H: 250 }, { notify: 'live' });
  const before = store.lch();
  const stored = { ...store.lastStored };
  assert.ok(store._ownWrites.length >= 1, 'the write is remembered');
  store.applyIncoming({ active: 'main', main: { rgb: stored }, rgb: stored });
  const after = store.lch();
  assert.ok(Math.abs(after.L - before.L) < 1e-12, 'the lightness is not re-derived');
  assert.ok(Math.abs(after.H - before.H) < 1e-9, 'the echo must not rotate the hue');
});

test('the echo ring matches on value, not on origin (documented limitation)', () => {
  const store = loadStore({ writeColor() {} });
  store.setLCH({ L: 0.5, C: 0.05, H: 20 }, { notify: 'live' });
  const stored = { ...store.lastStored };
  assert.equal(store._ownWrites.length, 1);

  store.applyIncoming({ active: 'main', main: { rgb: stored }, rgb: stored });
  assert.equal(store._ownWrites.length, 1, 'the ring stays armed');
  store.applyIncoming({ active: 'main', main: { rgb: { r: 1, g: 2, b: 3 } }, rgb: { r: 1, g: 2, b: 3 } });
  assert.equal(store._ownWrites.length, 0, 'any real host change ends the burst');
});

function interactionStore() {
  const calls = [];
  const store = loadStore({
    localFirst: true,
    interactionBegin: (s) => calls.push(['begin', s.id]),
    interactionUpdate: (s) => calls.push(['update', s.id, s.seq]),
    interactionEnd: (s) => calls.push(['end', s.id, s.seq, s.reason]),
    writeColor: () => calls.push(['write']),
  });
  store.connected = true;
  return { store, calls };
}

test('with local-first on, one drag opens one interaction and the commit closes it', () => {
  const { store, calls } = interactionStore();
  store.setLCH({ L: 0.5, C: 0.1, H: 30 }, { notify: 'live' });
  store.setLCH({ L: 0.6, C: 0.1, H: 30 }, { notify: 'live' });
  store.setLCH({ L: 0.6, C: 0.1, H: 30 }, { notify: 'commit' });
  const kinds = calls.map((c) => c[0]);
  assert.deepEqual(kinds, ['begin', 'update', 'update', 'end']);
  const ids = new Set(calls.map((c) => c[1]));
  assert.equal(ids.size, 1, 'the same interaction all the way through');
  assert.equal(calls[3][3], 'commit');
  assert.equal(store._interaction, null, 'closed');
});

test('a committed pick with no live write still writes the plain path', () => {
  const { store, calls } = interactionStore();
  store.setLCH({ L: 0.7, C: 0.02, H: 100 }, { notify: 'commit' });
  assert.deepEqual(calls.map((c) => c[0]), ['write'], 'a discrete pick is not an interaction');
});

test('a reject ends the interaction and the next drag opens a fresh one', () => {
  const { store, calls } = interactionStore();
  store.setLCH({ L: 0.5, C: 0.1, H: 30 }, { notify: 'live' });
  const first = calls[0][1];
  store.onInteractionReject();
  assert.equal(store._interaction, null);
  store.setLCH({ L: 0.4, C: 0.1, H: 30 }, { notify: 'live' });
  const second = calls.filter((c) => c[0] === 'begin').pop()[1];
  assert.notEqual(second, first, 'a new interaction id after a reject');
});

test('a lensed pick writes the band but keeps the pointer colour', () => {
  const writes = [];
  const store = loadStore({ writeColor: (v) => writes.push(v) });

  store.connected = true;
  store.liveSync = true;

  store.setLCH({ L: 0.6, C: 0.1, H: 30 }, {
    notify: 'commit',
    recorded: Color.oklchToOklab(0.57, 0.1, 30),
  });

  assert.ok(Math.abs(store.L - 0.6) < 1e-9, `L moved to ${store.L}`);

  const written = writes[writes.length - 1];
  const expected = Color.oklabToRgb(0.57, Color.oklchToOklab(0.57, 0.1, 30).a, Color.oklchToOklab(0.57, 0.1, 30).b);
  assert.ok(Math.abs(written.r - Math.round(expected.r * 255)) <= 1, `${written.r} vs ${expected.r * 255}`);
  assert.deepEqual(store.contentRgb(), written);
});

test('a plain set clears a previous lens override', () => {
  const writes = [];
  const store = loadStore({ writeColor: (v) => writes.push(v) });
  store.setLCH({ L: 0.6, C: 0.1, H: 30 }, { notify: 'commit', recorded: Color.oklchToOklab(0.5, 0.05, 200) });
  store.setLCH({ L: 0.6, C: 0.1, H: 30 }, { notify: 'commit' });
  const stored = store.contentRgb();
  const own = Color.oklabToRgb(store.L, store.a, store.b);
  assert.ok(Math.abs(stored.r - Math.round(own.r * 255)) <= 1, 'a plain set must not keep the old band');
});

test('a drag that ends with "commit what we have" keeps the lens band', () => {
  const writes = [];
  const store = loadStore({ writeColor: (v) => writes.push(v) });
  store.connected = true;
  store.liveSync = true;
  const band = Color.oklchToOklab(0.5, 0.05, 200);
  store.setLCH({ L: 0.62, C: 0.1, H: 30 }, { notify: 'live', recorded: band });
  const duringDrag = writes[writes.length - 1];
  store.recommit();
  const atRelease = writes[writes.length - 1];

  assert.deepEqual(atRelease, duringDrag, 'the band changed at pen-up');
  assert.ok(Math.abs(store.L - 0.62) < 1e-9, 'the store kept the cursor colour');
});

test('recommit after a plain pick sends that pick unchanged', () => {
  const writes = [];
  const store = loadStore({ writeColor: (v) => writes.push(v) });
  store.connected = true;
  store.liveSync = true;
  store.setLCH({ L: 0.62, C: 0.1, H: 30 }, { notify: 'live' });
  store.recommit();
  const own = Color.oklabToRgb(store.L, store.a, store.b);
  const written = writes[writes.length - 1];
  assert.ok(Math.abs(written.r - Math.round(own.r * 255)) <= 1);
});

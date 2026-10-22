'use strict';

// The pointer-up bridge: a release over CSP takes a fresh protocol read and
// commits exactly that colour. It must not read when no pick is waiting, must
// ignore a transparent colour, and must not stack reads on rapid ups.

const test = require('node:test');
const assert = require('node:assert');
const { createPointerHistory, createContactHistory } = require('../src/main/pointer-history');

const rgb = (r, g, b) => ({ r, g, b });

test('an up with a pending pick reads fresh and commits that colour', async () => {
  const reads = [];
  const commits = [];
  const onUp = createPointerHistory({
    readColor: async () => { reads.push(1); return { rgb: rgb(10, 20, 30), active: 'main' }; },
    commit: (c) => commits.push(c),
    hasPending: () => true,
  });
  await onUp();
  assert.equal(reads.length, 1);
  assert.deepEqual(commits, [rgb(10, 20, 30)]);
});

test('an up with nothing pending does not read CSP', async () => {
  let reads = 0;
  const commits = [];
  const onUp = createPointerHistory({
    readColor: async () => { reads += 1; return { rgb: rgb(1, 2, 3) }; },
    commit: (c) => commits.push(c),
    hasPending: () => false,
  });
  await onUp();
  assert.equal(reads, 0);
  assert.deepEqual(commits, []);
});

test('a partial read falls back to the active slot', async () => {
  const commits = [];
  const onUp = createPointerHistory({
    readColor: async () => ({ active: 'sub', main: { rgb: rgb(1, 2, 3) }, sub: { rgb: rgb(7, 8, 9) } }),
    commit: (c) => commits.push(c),
    hasPending: () => true,
  });
  await onUp();
  assert.deepEqual(commits, [rgb(7, 8, 9)]);
});

test('a transparent state and a failed read commit nothing', async () => {
  const commits = [];
  const transparent = createPointerHistory({
    readColor: async () => ({ rgb: rgb(1, 2, 3), transparent: true }),
    commit: (c) => commits.push(c),
  });
  await transparent();
  const failing = createPointerHistory({
    readColor: async () => { throw new Error('disconnected'); },
    commit: (c) => commits.push(c),
  });
  await failing();
  assert.deepEqual(commits, []);
});

test('overlapping ups do not stack reads', async () => {
  let reads = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const onUp = createPointerHistory({
    readColor: async () => { reads += 1; await gate; return { rgb: rgb(1, 2, 3) }; },
    commit: () => {},
  });
  const first = onUp();
  const second = onUp();
  release();
  await Promise.all([first, second]);
  assert.equal(reads, 1);
});

test('a canvas contact under the gate reads fresh and commits that colour', async () => {
  const commits = [];
  const onDown = createContactHistory({
    isOn: () => true,
    readColor: async () => ({ rgb: rgb(10, 20, 30), active: 'main' }),
    commit: (c) => commits.push(c),
  });
  await onDown({ canvas: true, alt: false });
  assert.deepEqual(commits, [rgb(10, 20, 30)]);
});

test('non-canvas, Alt and gate-off contacts do nothing', async () => {
  let reads = 0;
  const commits = [];
  const make = (isOn) => createContactHistory({
    isOn,
    readColor: async () => { reads += 1; return { rgb: rgb(1, 2, 3) }; },
    commit: (c) => commits.push(c),
  });
  await make(() => true)({ canvas: false, alt: false });
  await make(() => true)({ canvas: true, alt: true });
  await make(() => false)({ canvas: true, alt: false });
  assert.equal(reads, 0);
  assert.deepEqual(commits, []);
});

test('a lagging read that still shows the head falls back to the pending pick', async () => {
  const commits = [];
  const onDown = createContactHistory({
    isOn: () => true,
    readColor: async () => ({ rgb: rgb(1, 1, 1) }), // host lag: still the old head
    commit: (c) => commits.push(c),
    pending: () => rgb(9, 9, 9),
    head: () => rgb(1, 1, 1),
  });
  await onDown({ canvas: true });
  assert.deepEqual(commits, [rgb(9, 9, 9)]);
});

test('a failed read records the pending pick', async () => {
  const commits = [];
  const onDown = createContactHistory({
    isOn: () => true,
    readColor: async () => { throw new Error('down'); },
    commit: (c) => commits.push(c),
    pending: () => rgb(5, 6, 7),
  });
  await onDown({ canvas: true });
  assert.deepEqual(commits, [rgb(5, 6, 7)]);
});

test('a transparent contact drops the pending colour', async () => {
  const commits = [];
  let dropped = 0;
  const onDown = createContactHistory({
    isOn: () => true,
    readColor: async () => ({ rgb: rgb(1, 2, 3), transparent: true }),
    commit: (c) => commits.push(c),
    pending: () => rgb(9, 9, 9),
    drop: () => { dropped += 1; },
  });
  await onDown({ canvas: true });
  assert.deepEqual(commits, []);
  assert.equal(dropped, 1);
});

test('the gate switching off during the read drops the contact', async () => {
  let on = true;
  const commits = [];
  const onDown = createContactHistory({
    isOn: () => on,
    readColor: async () => { on = false; return { rgb: rgb(4, 5, 6) }; },
    commit: (c) => commits.push(c),
  });
  await onDown({ canvas: true });
  assert.deepEqual(commits, []);
});

test('overlapping contacts make one read', async () => {
  let reads = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const onDown = createContactHistory({
    isOn: () => true,
    readColor: async () => { reads += 1; await gate; return { rgb: rgb(1, 2, 3) }; },
    commit: () => {},
  });
  const first = onDown({ canvas: true });
  const second = onDown({ canvas: true });
  release();
  await Promise.all([first, second]);
  assert.equal(reads, 1);
});

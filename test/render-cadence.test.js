'use strict';

// The interactive cadence (src/shared/render-cadence.js): a budget measured in the
// interactive build, every panel that fits it, and never a panel starved forever.

const test = require('node:test');
const assert = require('node:assert');
const Cadence = require('../src/shared/render-cadence');

test('a build that fits a frame waits nothing', () => {
  assert.equal(Cadence.holdFor(8), 0);
  assert.equal(Cadence.holdFor(14), 0);
  assert.equal(Cadence.holdFor(0), 0);
  assert.equal(Cadence.holdFor(NaN), 0);
});

test('a heavy build is spaced out, but never longer than the cap', () => {
  assert.equal(Cadence.holdFor(40), 26);
  assert.equal(Cadence.holdFor(500), 200);
});

test('one panel per frame, round-robin, wrapping', () => {
  const visible = [0, 2];
  let cursor = 0;
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    const pick = Cadence.pickPanel({ visible, cursor, now: i, holdUntil: 0 });
    assert.ok(pick.panel >= 0);
    seen.push(pick.panel);
    cursor = pick.cursor;
  }
  assert.deepEqual(seen, [0, 2, 0, 2]);
});

test('a hold repaints overlays only and keeps the cursor', () => {
  const pick = Cadence.pickPanel({ visible: [1], cursor: 0, now: 10, holdUntil: 20 });
  assert.equal(pick.panel, -1);
  assert.equal(pick.cursor, 0);
});

test('nothing visible never builds', () => {
  assert.deepEqual(Cadence.pickPanel({ visible: [], cursor: 3, now: 5, holdUntil: 0 }), { panel: -1, cursor: 3 });
  assert.deepEqual(Cadence.pickPanel({}), { panel: -1, cursor: 0 });
});

test('a stale cursor is normalised', () => {
  const pick = Cadence.pickPanel({ visible: [0, 1, 2], cursor: 7, now: 5, holdUntil: 0 });
  assert.equal(pick.panel, 1);
  assert.equal(pick.cursor, 2);
});

// --- choosePanels: every panel that fits the frame (the analytic Slices planes) ---

test('every panel that fits the frame rebuilds, in round-robin order', () => {
  const pick = Cadence.choosePanels({ visible: [0, 1, 2], cursor: 0, costs: [2, 2, 3], budget: 8 });
  assert.deepEqual(pick.panels, [0, 1, 2]);
  assert.equal(pick.cursor, 1);
});

test('an expensive panel is spaced out, never starved', () => {
  const visible = [0, 1, 2];
  const costs = [0, 0, 20];
  const turns = [[], [], []];
  let cursor = 0;
  for (let frame = 0; frame < 6; frame += 1) {
    const pick = Cadence.choosePanels({ visible, cursor, costs, budget: 8 });
    for (const p of pick.panels) turns[p].push(frame);
    cursor = pick.cursor;
  }
  // The cheap pair shares every frame it is first in; the heavy one still gets its
  // own turn alone, once every third frame.
  assert.deepEqual(turns[0], [0, 1, 3, 4]);
  assert.deepEqual(turns[1], [0, 1, 3, 4]);
  assert.deepEqual(turns[2], [2, 5]);
});

test('a panel whose cost is unknown is treated as free', () => {
  const pick = Cadence.choosePanels({ visible: [0, 1], cursor: 0, costs: [], budget: 8 });
  assert.deepEqual(pick.panels, [0, 1]);
});

test('a hold rebuilds nothing and keeps the cursor', () => {
  const pick = Cadence.choosePanels({ visible: [0, 1], cursor: 1, now: 10, holdUntil: 20 });
  assert.deepEqual(pick.panels, []);
  assert.equal(pick.cursor, 1);
});

test('nothing visible is not a rebuild', () => {
  assert.deepEqual(Cadence.choosePanels({ visible: [] }), { panels: [], cursor: 0 });
  assert.deepEqual(Cadence.choosePanels({}), { panels: [], cursor: 0 });
});

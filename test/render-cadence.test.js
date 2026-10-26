'use strict';

// The interactive cadence (src/shared/render-cadence.js): one panel per frame, a
// budget measured in the interactive build, and never a panel starved forever.

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

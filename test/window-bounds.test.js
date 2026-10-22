'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveWindowBounds, pickDisplay } = require('../src/main/window-bounds');

const PRIMARY = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
const SECOND = { id: 2, workArea: { x: 1920, y: -200, width: 2560, height: 1440 } };
const LEFT = { id: 3, workArea: { x: -1280, y: 0, width: 1280, height: 1024 } };
const ALL = [PRIMARY, SECOND, LEFT];
const SIZE = { width: 260, height: 640 };

test('reopening restores the saved monitor and position', () => {
  const saved = { x: 2200, y: 300, displayId: 2 };
  const b = resolveWindowBounds(saved, SIZE, ALL, { x: 0, y: 0 }, PRIMARY);
  assert.equal(b.displayId, 2);
  assert.equal(b.x, 2200);
  assert.equal(b.y, 300);
  assert.equal(b.hadPosition, true);
});

test('an unplugged monitor falls back to the cursor\'s display', () => {
  const saved = { x: 2200, y: 300, displayId: 99 };
  const b = resolveWindowBounds(saved, SIZE, [PRIMARY, LEFT], { x: -600, y: 400 }, PRIMARY);
  assert.equal(b.displayId, 3, 'landed on the display under the cursor');
  assert.ok(b.x >= LEFT.workArea.x && b.x + b.width <= LEFT.workArea.x + LEFT.workArea.width, `x=${b.x} is inside`);
});

test('a saved position is clamped into a live work area', () => {
  const saved = { x: 5000, y: 5000, displayId: 1 };
  const b = resolveWindowBounds(saved, SIZE, ALL, null, PRIMARY);
  assert.ok(b.x + b.width <= PRIMARY.workArea.width, `x=${b.x} fits`);
  assert.ok(b.y + b.height <= PRIMARY.workArea.height, `y=${b.y} fits`);
  assert.ok(b.x >= 0 && b.y >= 0);
});

test('a negative-origin monitor is handled', () => {
  const b = resolveWindowBounds({ x: -1200, y: 100, displayId: 3 }, SIZE, ALL, null, PRIMARY);
  assert.equal(b.displayId, 3);
  assert.equal(b.x, -1200);
});

test('with no memory the window centres on the cursor\'s display', () => {
  const b = resolveWindowBounds(null, SIZE, ALL, { x: 2500, y: 100 }, PRIMARY);
  assert.equal(b.displayId, 2);
  assert.equal(b.hadPosition, false);
  assert.equal(b.x, SECOND.workArea.x + Math.round((SECOND.workArea.width - SIZE.width) / 2));
});

test('a size larger than the work area is shrunk to fit', () => {
  const b = resolveWindowBounds({ x: 0, y: 0, displayId: 3 }, { width: 4000, height: 4000 }, ALL, null, PRIMARY);
  assert.equal(b.width, LEFT.workArea.width);
  assert.equal(b.height, LEFT.workArea.height);
});

test('pickDisplay prefers the saved display over the cursor', () => {
  assert.equal(pickDisplay({ displayId: 3 }, ALL, { x: 100, y: 100 }, PRIMARY).id, 3);
});

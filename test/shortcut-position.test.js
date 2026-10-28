'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { positionBox } = require('../src/shared/shortcut-position');

const area = { x: 0, y: 0, width: 1000, height: 800 };
const size = { width: 200, height: 100 };
const cursor = { x: 500, y: 400 };

test('keep does not move the window', () => {
  assert.equal(positionBox({ mode: 'keep', cursor, size, area }), null);
});

test('center centers the window on the cursor', () => {
  assert.deepEqual(positionBox({ mode: 'center', cursor, size, area }), { x: 400, y: 350 });
});

test('directional modes sit on that side with an 8 px gap', () => {
  assert.deepEqual(positionBox({ mode: 'top-left', cursor, size, area }), { x: 292, y: 292 });
  assert.deepEqual(positionBox({ mode: 'top-right', cursor, size, area }), { x: 508, y: 292 });
  assert.deepEqual(positionBox({ mode: 'bottom-left', cursor, size, area }), { x: 292, y: 408 });
  assert.deepEqual(positionBox({ mode: 'bottom-right', cursor, size, area }), { x: 508, y: 408 });
});

test('placement is clamped into the work area', () => {
  const near = { x: 995, y: 795 };
  assert.deepEqual(positionBox({ mode: 'bottom-right', cursor: near, size, area }), { x: 796, y: 696 });
  assert.deepEqual(positionBox({ mode: 'top-left', cursor: { x: 2, y: 2 }, size, area }), { x: 4, y: 4 });
});

test('unknown modes are ignored', () => {
  assert.equal(positionBox({ mode: 'somewhere', cursor, size, area }), null);
});

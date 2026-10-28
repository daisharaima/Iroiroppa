'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmBox, MIN_HEIGHT } = require('../src/main/overlay-confirm-box');

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };

test('the merge card stays inside the work area', () => {
  const box = confirmBox({ anchor: { x: 1910, y: 1030 }, area: AREA, message: 'x', detail: 'y' });
  assert.ok(box.x + box.width <= AREA.width);
  assert.ok(box.y + box.height <= AREA.height);
  assert.ok(box.height >= MIN_HEIGHT);
});

test('a long message grows the card but stays capped', () => {
  const short = confirmBox({ anchor: { x: 500, y: 500 }, area: AREA, message: 'x' });
  const long = confirmBox({ anchor: { x: 500, y: 500 }, area: AREA, message: 'x'.repeat(400), detail: 'y'.repeat(300) });
  assert.ok(long.height > short.height);
  assert.ok(long.height <= 240);
});

test('a tiny display still gets a useful card', () => {
  const box = confirmBox({ anchor: { x: 0, y: 0 }, area: { x: 0, y: 0, width: 260, height: 200 }, message: 'm' });
  assert.equal(box.width, 248);
  assert.ok(box.x >= 0 && box.y >= 0);
});

'use strict';

// The shared colour-history rule (): quantized-sRGB head
// dedupe and a cap.

const test = require('node:test');
const assert = require('node:assert/strict');
const { addToHistory } = require('../src/shared/history');

test('a new colour is pushed to the head', () => {
  const list = [];
  assert.equal(addToHistory(list, { r: 1, g: 2, b: 3 }, 100), true);
  assert.deepEqual(list, [{ r: 1, g: 2, b: 3 }]);
});

test('a colour matching the head is dropped', () => {
  const list = [{ r: 1, g: 2, b: 3 }];
  assert.equal(addToHistory(list, { r: 1, g: 2, b: 3 }, 100), false);
  assert.equal(list.length, 1);
});

test('a fractional pick is quantized before the dedupe', () => {
  const list = [{ r: 10, g: 20, b: 30 }];
  assert.equal(addToHistory(list, { r: 10.2, g: 19.8, b: 30.1 }, 100), false, 'rounds to the same value');
  assert.equal(addToHistory(list, { r: 10.6, g: 20, b: 30 }, 100), true, 'rounds to something new');
});

test('the list is capped at max', () => {
  const list = [];
  for (let i = 0; i < 10; i += 1) addToHistory(list, { r: i, g: i, b: i }, 3);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((c) => c.r), [9, 8, 7]);
});

test('a malformed value changes nothing', () => {
  const list = [{ r: 1, g: 2, b: 3 }];
  assert.equal(addToHistory(list, null, 100), false);
  assert.equal(addToHistory(list, { r: 'x', g: 2, b: 3 }, 100), false);
  assert.equal(addToHistory(list, { r: NaN, g: 2, b: 3 }, 100), false);
  assert.deepEqual(list, [{ r: 1, g: 2, b: 3 }]);
});

test('a channel outside 0..255 is clamped before it is stored', () => {
  const list = [];
  assert.equal(addToHistory(list, { r: 255.6, g: -0.4, b: 128 }, 100), true);
  assert.deepEqual(list[0], { r: 255, g: 0, b: 128 });
  // and the clamped head then dedupes against an honest 255
  assert.equal(addToHistory(list, { r: 255, g: 0, b: 128 }, 100), false);
});

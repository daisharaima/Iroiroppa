'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { drawIcon, rgbaToBgra } = require('../src/shared/icon-art');

const at = (rgba, size, x, y) => {
  const i = (y * size + x) * 4;
  return [...rgba.slice(i, i + 4)];
};

test('the icon has transparent rounded corners and an opaque centre', () => {
  const size = 64;
  const rgba = drawIcon(size);
  assert.equal(at(rgba, size, 0, 0)[3], 0, 'corner transparent');
  assert.equal(at(rgba, size, size - 1, 0)[3], 0);
  assert.equal(at(rgba, size, Math.floor(size / 2), Math.floor(size / 2))[3], 255);
});

test('the centre is the big I, not a hue wheel', () => {
  const size = 64;
  const rgba = drawIcon(size);
  const centre = at(rgba, size, size / 2, size / 2);
  assert.equal(centre[0], 126);
  assert.equal(centre[1], 107);
  assert.equal(centre[2], 142);
  // A pastel background pixel near the top-left is low-chroma (R≈G≈B-ish),
  // unlike the old saturated hue ring.
  const bg = at(rgba, size, size / 2, 9);
  assert.ok(Math.max(...bg.slice(0, 3)) - Math.min(...bg.slice(0, 3)) < 40);
});

test('the same art converts to BGRA', () => {
  const rgba = drawIcon(32);
  const bgra = rgbaToBgra(rgba);
  const i = (16 * 32 + 16) * 4;
  assert.equal(bgra[i], rgba[i + 2]);
  assert.equal(bgra[i + 1], rgba[i + 1]);
  assert.equal(bgra[i + 2], rgba[i]);
});

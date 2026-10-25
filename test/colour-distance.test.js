'use strict';

// The MetricSpace distance helper (docs/COLOR.md, "Distance"). It is not used by
// any picker yet; these tests pin the numbers and the null-not-throw contract.

const test = require('node:test');
const assert = require('node:assert');

const Color = require('../src/shared/color');
const Dist = require('../src/shared/colour-distance');

const lab = (hex) => {
  const rgb = Color.hexToRgb(hex);
  return Color.rgbToOklab(rgb.r / 255, rgb.g / 255, rgb.b / 255);
};

test('identical colours have no distance', () => {
  const c = lab('#3b82f6');
  assert.equal(Dist.difference(c, c), 0);
  assert.equal(Dist.jnd(c, c), 0);
});

test('the trained metric reproduces the documented pair', () => {
  // The Helmlab README quotes 0.0227 for this pair.
  const d = Dist.difference(lab('#3b82f6'), lab('#4c8af7'));
  assert.ok(Math.abs(d - 0.0227) < 2e-3, `expected about 0.0227, got ${d}`);
});

test('jnd is the difference divided by the JND constant', () => {
  const a = lab('#808080');
  const b = lab('#828282');
  const d = Dist.difference(a, b);
  const j = Dist.jnd(a, b);
  assert.ok(Math.abs(j * Dist.JND - d) < 1e-12);
  assert.ok(j > 0 && j < 1, 'a two-step grey is under one JND');
});

test('the distance is symmetric', () => {
  const a = lab('#ff0000');
  const b = lab('#00ff00');
  assert.ok(Math.abs(Dist.difference(a, b) - Dist.difference(b, a)) < 1e-12);
});

test('nearest picks the closer colour and reports the index', () => {
  const target = lab('#3b82f6');
  const hit = Dist.nearest(target, [lab('#4c8a00'), lab('#4c8af7'), lab('#000000')]);
  assert.equal(hit.index, 1);
  assert.ok(hit.distance < 0.05);
});

test('bad input returns null instead of throwing', () => {
  assert.equal(Dist.difference(null, lab('#ffffff')), null);
  assert.equal(Dist.difference({ L: NaN, a: 0, b: 0 }, lab('#ffffff')), null);
  assert.equal(Dist.nearest(lab('#ffffff'), []), null);
  assert.equal(Dist.nearest(lab('#ffffff'), 'nope'), null);
});

test('the helper is available when the vendored bundle is present', () => {
  assert.equal(Dist.available, true);
});

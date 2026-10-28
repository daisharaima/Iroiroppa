'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { overlayShouldStay } = require('../src/shared/overlay-ownership');

test('the overlay is hidden only when nothing owns it', () => {
  assert.equal(overlayShouldStay({}), false);
  assert.equal(overlayShouldStay({ menu: true }), true);
  assert.equal(overlayShouldStay({ tooltip: true }), true);
  assert.equal(overlayShouldStay({ confirm: true }), true);
  assert.equal(overlayShouldStay({ dragging: true }), true);
  assert.equal(overlayShouldStay({ preview: true }), true);
});

test('a drag or merge card keeps the overlay through the band watch', () => {
  assert.equal(overlayShouldStay({ dragging: true, confirm: false }), true);
  assert.equal(overlayShouldStay({ dragging: false, confirm: true }), true);
});

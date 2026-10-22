'use strict';

// The drag overlay must never cover a whole display: Windows 11 turns Do Not Disturb
// on for a full-screen app, and the palette drag used to show a desktop-sized surface.
// See src/main/overlay-bounds.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const { overlayBounds } = require('../src/main/overlay-bounds');

const display = (x, y, width, height, taskbar = 40) => ({
  bounds: { x, y, width, height },
  workArea: { x, y, width, height: height - taskbar },
});

test('the overlay is the union of the work areas, not of the displays', () => {
  const out = overlayBounds([display(0, 0, 1920, 1080, 48)]);
  assert.deepEqual(out, { x: 1, y: 1, width: 1918, height: 1030 });
});

test('a second monitor extends the surface and keeps a negative origin', () => {
  const out = overlayBounds([
    display(0, 0, 1920, 1080, 48),
    display(-2560, 0, 2560, 1440, 48),
  ]);
  assert.equal(out.x, -2559);
  assert.equal(out.width, 2559 + 1919);
  assert.equal(out.height, 1440 - 48 - 2);
});

test('the cap and an empty display list stay sane', () => {
  const big = overlayBounds([display(0, 0, 20000, 20000, 0)], { cap: 4096 });
  assert.ok(big.width <= 4096 && big.height <= 4096);
  const none = overlayBounds([]);
  assert.ok(none.width > 0 && none.height > 0);
});

test('the inset is configurable and never negative', () => {
  const out = overlayBounds([display(0, 0, 800, 600, 0)], { inset: 0 });
  assert.deepEqual(out, { x: 0, y: 0, width: 800, height: 600 });
  const clamped = overlayBounds([display(0, 0, 800, 600, 0)], { inset: -5 });
  assert.deepEqual(clamped, { x: 0, y: 0, width: 800, height: 600 });
});

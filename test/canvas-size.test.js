'use strict';

// The backing-store scale (src/shared/canvas-size.js): a pixel budget instead of a fixed
// 2×, so a module stretched large does not render four times the pixels and stutter.

const test = require('node:test');
const assert = require('node:assert');
const Size = require('../src/shared/canvas-size');

test('a small module still supersamples', () => {
  const s = Size.backingScale(160, 160, { want: 2 });
  assert.ok(s > 1.5 && s <= 2, `scale ${s}`);
});

test('a large module gives up supersampling, never drops below 1×', () => {
  assert.strictEqual(Size.backingScale(600, 600, { want: 2 }), 1);
  assert.strictEqual(Size.backingScale(1200, 900, { want: 2.5 }), 1);
});

test('the total pixels stay within the budget when > 1× is used', () => {
  for (const [w, h] of [[120, 160], [300, 300], [420, 500], [700, 300]]) {
    const s = Size.backingScale(w, h, { want: 2 });
    const px = Math.round(w * s) * Math.round(h * s);
    assert.ok(s >= 1);
    if (s > 1) assert.ok(px <= Size.IDLE_BUDGET * 1.05, `${w}x${h} at ${s}: ${px}`);
  }
});

test('the live budget is cheaper than the idle one', () => {
  assert.ok(Size.LIVE_BUDGET < Size.IDLE_BUDGET);
  const idle = Size.backingScale(320, 320, { want: 2, budget: Size.IDLE_BUDGET });
  const live = Size.backingScale(320, 320, { want: 1, budget: Size.LIVE_BUDGET });
  assert.ok(live <= idle);
});

test('want caps the scale', () => {
  assert.ok(Size.backingScale(100, 100, { want: 1 }) === 1);
  assert.ok(Size.backingScale(100, 100, { want: 2.5 }) <= 2.5);
});

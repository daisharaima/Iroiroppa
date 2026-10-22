'use strict';

// The canonical value is OKLab; OKLCH is a derived view (docs/COLOR.md).
// These tests pin the one thing that must never drift: rendering from the
// canonical OKLab is bit-for-bit the same as rendering from OKLCH, so swapping
// the store's representation cannot move a single displayed channel.

const test = require('node:test');
const assert = require('node:assert/strict');

const Color = require('../src/shared/color');

const grid = (() => {
  const pts = [];
  for (let L = 0; L <= 1.0001; L += 0.07) {
    for (let C = 0; C <= 0.5; C += 0.03) {
      for (let H = 0; H < 360; H += 15) pts.push({ L, C, H });
    }
  }
  return pts;
})();

test('oklabToRgb is bit-identical to oklchToRgb across the grid', () => {
  for (const { L, C, H } of grid) {
    const ab = Color.oklchToOklab(L, C, H);
    const viaLab = Color.oklabToRgb(L, ab.a, ab.b);
    const viaLch = Color.oklchToRgb(L, C, H);
    assert.equal(viaLab.r, viaLch.r, `r @ L${L} C${C} H${H}`);
    assert.equal(viaLab.g, viaLch.g, `g @ L${L} C${C} H${H}`);
    assert.equal(viaLab.b, viaLch.b, `b @ L${L} C${C} H${H}`);
  }
});

test('oklch -> oklab -> oklch round-trips within float tolerance', () => {
  for (const { L, C, H } of grid) {
    const ab = Color.oklchToOklab(L, C, H);
    const back = Color.oklabToOklch(L, ab.a, ab.b);
    assert.equal(back.L, L);
    assert.ok(Math.abs(back.C - C) <= 1e-12 * Math.max(1, C), `C ${back.C} vs ${C}`);
    if (C > 1e-9) {
      const d = ((back.H - H) % 360 + 360) % 360;
      assert.ok(Math.min(d, 360 - d) < 1e-9, `H ${back.H} vs ${H}`);
    }
  }
});

test('a zero-chroma colour carries no hue (the anchor lives outside the value)', () => {
  const ab = Color.oklchToOklab(0.5, 0, 200);
  assert.ok(ab.a === 0, `a=${ab.a}`);
  assert.ok(ab.b === 0, `b=${ab.b}`);
  // The polar view has no meaningful hue here (atan2 of signed zeros), which is
  // exactly why the store keeps a hue anchor beside the canonical value —
  // `lch()` returns that anchor, never a hue derived from the value.
  assert.ok(Color.oklabToOklch(0.5, ab.a, ab.b).C === 0);
});

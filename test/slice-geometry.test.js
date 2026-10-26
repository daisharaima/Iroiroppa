'use strict';

// The slice geometry bridge (docs/MODULES.md, "Slice projections"): the raster
// and the pointer share one mapping, the crosshair can only sit on a reachable
// point, and the Shift lock / guide line are computed in the same axis space.

const test = require('node:test');
const assert = require('node:assert/strict');

const Models = require('../src/shared/color-models');
const G = require('../src/shared/slice-geometry');

const store = { cmax: () => 0.4, inGamut: () => true };

const midAxes = (model) => model.axes.map((a) => (a.min + a.max) / 2);

test('pickAxes / pointOf round-trip for every model and plane', () => {
  for (const model of Models.list()) {
    for (let p = 0; p < 3; p += 1) {
      const fixed = midAxes(model);
      for (let i = 0; i <= 10; i += 1) {
        for (let j = 0; j <= 10; j += 1) {
          const u = i / 10;
          const v = j / 10;
          const axes = G.pickAxes(model, p, u, v, fixed, store);
          const back = G.pointOf(model, p, axes, store);
          assert.ok(Math.abs(back.u - u) < 1e-9, `${model.id} plane ${p} u ${u} -> ${back.u}`);
          assert.ok(Math.abs(back.v - v) < 1e-9, `${model.id} plane ${p} v ${v} -> ${back.v}`);
        }
      }
    }
  }
});

test('pickAxes keeps the fixed axis exactly where it was', () => {
  const model = Models.get('okhsv'); // plane 0 = (V,S) fixed H
  const fixed = [123, 0.5, 0.5];
  const axes = G.pickAxes(model, 0, 0.2, 0.7, fixed, store);
  assert.equal(axes[0], 123, 'the fixed hue is untouched');
  assert.ok(axes[2] < 0.5, 'the free lightness axis follows u');
});

test('clampAxes marks out-of-range and non-finite values', () => {
  const model = Models.get('okhsv');
  const low = G.clampAxes(model, [-10, -0.2, 0.5], store);
  assert.ok(low.clamped);
  assert.equal(low.axes[0], 0);
  assert.equal(low.axes[1], 0);
  const high = G.clampAxes(model, [400, 2, 0.5], store);
  assert.equal(high.axes[0], 360);
  assert.equal(high.axes[1], 1);
  const bad = G.clampAxes(model, [10, NaN, 0.5], store);
  assert.ok(bad.clamped);
  assert.ok(Number.isFinite(bad.axes[1]));
});

test('contentPoint removes the canvas border and clamps', () => {
  const metrics = {
    left: 10, top: 20, clientLeft: 1, clientTop: 1,
    clientWidth: 100, clientHeight: 50,
  };
  const mid = G.contentPoint(metrics, 10 + 1 + 50, 20 + 1 + 25);
  assert.equal(mid.x, 0.5);
  assert.equal(mid.y, 0.5);
  const outside = G.contentPoint(metrics, -100, -100);
  assert.deepEqual(outside, { x: 0, y: 0 });
  const zero = G.contentPoint({ left: 0, top: 0, clientWidth: 0, clientHeight: 0 }, 5, 5);
  assert.deepEqual(zero, { x: 0, y: 0 }, 'an unmeasured canvas never divides by zero');
});

test('the guide line is the iso-lightness line, or null when the plane fixes it', () => {
  const oklch = Models.get('oklch');
  const LC = G.guideLine(oklch, 0, 0.5, store);
  assert.deepEqual(LC, { u0: 0.5, v0: 0, u1: 0.5, v1: 1 });
  assert.equal(G.guideLine(oklch, 1, 0.5, store), null, 'the constant-lightness slice has no line');
  const HL = G.guideLine(oklch, 2, 0.75, store);
  assert.deepEqual(HL, { u0: 0, v0: 0.75, u1: 1, v1: 0.75 });
});

test('lockAxes freezes the model light axis', () => {
  const hsv = Models.get('okhsv');
  assert.equal(Models.lightAxis(hsv), 2);
  const out = G.lockAxes(hsv, [10, 0.5, 0.9], 0.3);
  assert.deepEqual(out, [10, 0.5, 0.3]);
});

test('inside follows the working gamut, never a model `dense` flag', () => {
  const model = Models.get('okhsv');
  assert.equal(G.inside(model, [10, 0.5, 0.5], { inGamut: () => false }), false);
  assert.equal(G.inside(model, [10, 0.5, 0.5], { inGamut: () => true }), true);
});

test('runs splits a sampled predicate into contiguous spans', () => {
  assert.deepEqual(G.runs([false, true, true, false, true]), [[1, 2], [4, 4]]);
  assert.deepEqual(G.runs([true, true]), [[0, 1]]);
  assert.deepEqual(G.runs([]), []);
});

test('planeOf is the model plane and the label names its two free channels', () => {
  assert.deepEqual(G.planeOf(Models.get('okhsv'), 0), [2, 1, 0]);
  assert.equal(Models.planeLabel(Models.get('okhsv'), 0), 'V \u00d7 S');
  assert.equal(Models.planeLabel(Models.get('oklch'), 1), 'H \u00d7 C');
});

// --- canonical lightness guide and lock -------------------------------------

test('every model declares whether its light axis is canonical', () => {
  for (const model of Models.list()) {
    assert.ok(model.lightSource === 'native' || model.lightSource === 'oklab', `${model.id} lightSource`);
    assert.equal(G.lightAxisIsCanonical(model), model.lightSource === 'native');
  }
  assert.equal(G.lightnessOf(Models.get('oklch'), [0.42, 0.1, 30]), 0.42);
  const hsv = Models.get('okhsv');
  const hsvAxes = [30, 0.8, 0.5];
  assert.ok(Math.abs(G.lightnessOf(hsv, hsvAxes) - hsv.toLab(hsvAxes).L) < 1e-12);
});

test('setLightness holds canonical OKLab L (and HelmGen its own L)', () => {
  const hsv = Models.get('okhsv');
  const axes = [210, 0.7, 0.65];
  const target = G.lightnessOf(hsv, axes);
  const out = G.setLightness(hsv, axes, target - 0.1, store);
  assert.ok(Math.abs(G.lightnessOf(hsv, out) - (target - 0.1)) < 1e-4);
  assert.equal(out[0], axes[0], 'the hue is untouched');
  assert.equal(out[1], axes[1], 'the saturation is untouched');
  if (Models.has('helmgenlch')) {
    const helm = Models.get('helmgenlch');
    const h = [0.55, 0.12, 200];
    const held = G.setLightness(helm, h, h[0] - 0.2, store);
    assert.ok(Math.abs(held[0] - (h[0] - 0.2)) < 1e-12, 'HelmGen keeps its native L');
  }
});

test('a fixed-light plane projects onto its iso-L contour without moving the plane', () => {
  const hsv = Models.get('okhsv');
  // Plane 1 is H x S with V fixed; pick a point, then lock its current L.
  const fixed = [0, 0, 0.6];
  const picked = G.pickAxes(hsv, 1, 0.4, 0.7, fixed, store);
  const target = G.lightnessOf(hsv, picked);
  const moved = picked.slice();
  moved[1] = 0.2; // a different saturation
  const held = G.applyLightness(hsv, 1, moved, target, store);
  assert.ok(Math.abs(G.lightnessOf(hsv, held) - target) < 1e-4);
  assert.equal(held[0], moved[0], 'the hue follows the pointer');
  assert.equal(held[2], moved[2], 'the fixed V is untouched');
  assert.notEqual(held[1], moved[1], 'the chroma was solved');
});

test('guideCurve is straight in OKLCH, curved in OKHSV, and null where L is fixed', () => {
  const oklch = Models.get('oklch');
  const lc = G.guideCurve(oklch, 0, 0.6, [0.6, 0.1, 30], store, 8);
  const us = lc.points.map((p) => p.u);
  assert.ok(us.every((u) => Math.abs(u - us[0]) < 1e-9), 'OKLCH LC is vertical');
  assert.equal(G.guideCurve(oklch, 1, 0.6, [0.6, 0.1, 30], store, 8), null,
    'the constant-L plane is the whole guide');
  const hsv = Models.get('okhsv');
  const curve = G.guideCurve(hsv, 0, G.lightnessOf(hsv, [30, 0.9, 0.5]), [30, 0.9, 0.5], store, 12);
  assert.ok(curve && curve.points.length === 13);
  const delta = Math.max(...curve.points.map((p) => p.u)) - Math.min(...curve.points.map((p) => p.u));
  assert.ok(delta > 1e-3, 'OKHSV LC is an organic curve');
  const hc = G.guideCurve(hsv, 1, G.lightnessOf(hsv, [30, 0.5, 0.6]), [30, 0.5, 0.6], store, 12);
  assert.ok(hc && hc.points.length > 0, 'OKHSV H x C has an iso-L contour');
  if (Models.has('helmgenlch')) {
    const helm = Models.get('helmgenlch');
    const g = G.guideCurve(helm, 0, 0.4, [0.4, 0.1, 200], store, 8);
    const hu = g.points.map((p) => p.u);
    assert.ok(hu.every((u) => Math.abs(u - hu[0]) < 1e-9), 'HelmGen LCH uses its own L');
  }
});

test('an unreachable target clamps instead of throwing', () => {
  const hsv = Models.get('okhsv');
  const out = G.setLightness(hsv, [30, 0.5, 0.5], 5, store);
  assert.ok(Number.isFinite(out[2]));
  assert.ok(out[2] >= 0 && out[2] <= 1);
});

test('guide lightness is native to the model', () => {
  const oklch = Models.get('oklch');
  const axes = [0.62, 0.1, 217];
  const lab = oklch.toLab(axes);
  assert.equal(G.lightnessOf(oklch, axes), lab.L);
  const hsv = Models.get('okhsv');
  const hsvAxes = [217, 0.7, 0.6];
  assert.equal(G.lightnessOf(hsv, hsvAxes), hsv.toLab(hsvAxes).L, 'OKHSV uses OKLab L, not V');
  const helm = Models.get('helmgenlch');
  if (helm) {
    assert.equal(G.lightnessOf(helm, [0.45, 0.1, 217]), 0.45, 'HelmGen uses its own L');
  }
});

test('native lightness is what setLightness holds', () => {
  const oklch = Models.get('oklch');
  const axes = [0.62, 0.1, 217];
  const target = G.lightnessOf(oklch, axes) - 0.06;
  const held = G.setLightness(oklch, axes, target, store);
  assert.ok(G.lightnessReached(oklch, held, target));
  assert.ok(Math.abs(G.lightnessOf(oklch, held) - target) < 1e-4);
  const hsv = Models.get('okhsv');
  const hsvAxes = [217, 0.7, 0.6];
  const hsl = G.lightnessOf(hsv, hsvAxes) - 0.05;
  const held2 = G.setLightness(hsv, hsvAxes, hsl, store);
  assert.ok(G.lightnessReached(hsv, held2, hsl));
  assert.ok(!G.lightnessReached(hsv, hsvAxes, hsl + 0.5));
});

test('an unreachable native guide target is not drawn along the panel edge', () => {
  const hsv = Models.get('okhsv');
  const axes = [30, 0.9, 0.5];
  const target = G.lightnessOf(hsv, axes) + 0.5;
  const curve = G.guideCurve(hsv, 1, target, axes, store, 48);
  assert.ok(curve, 'the contour is still returned');
  assert.ok(curve.flags.every((ok) => ok === false), 'clamped points are invalid');
  assert.deepEqual(G.runs(curve.flags), []);
});

test('a native fixed-light plane has no guide when its whole plane is one lightness', () => {
  const oklch = Models.get('oklch');
  const axes = [0.62, 0.1, 217];
  assert.equal(G.guideCurve(oklch, 1, 0.62, axes, store, 8), null);
  const helm = Models.get('helmgenlch');
  if (helm) {
    const h = [0.45, 0.1, 217];
    assert.equal(G.guideCurve(helm, 1, 0.45, h, store, 8), null);
  }
});

'use strict';

// The colour-model adapter contract (docs/COLOR.md). A model is a view over the
// canonical OKLab value; it must round-trip through OKLab. This test covers every
// registered model automatically, so a new model is covered the moment it is
// registered.

const test = require('node:test');
const assert = require('node:assert/strict');

const Models = require('../src/shared/color-models');
const Color = require('../src/shared/color');

const samples = (() => {
  const out = [];
  for (let L = 0.05; L <= 0.98; L += 0.09) {
    for (let C = 0; C <= 0.4; C += 0.05) {
      for (let H = 0; H < 360; H += 20) out.push(Color.oklchToOklab(L, C, H));
    }
  }
  return out;
})();

test('registry basics', () => {
  assert.ok(Models.has(Models.DEFAULT_ID), 'default model is registered');
  assert.equal(Models.get('nope'), null);
  assert.ok(Models.list().length >= 1);
  for (const m of Models.list()) {
    assert.equal(m.axes.length, 3);
    assert.deepEqual(Models.ids().includes(m.id), true);
  }
});

test('every model round-trips OKLab -> axes -> OKLab', () => {
  for (const model of Models.list()) {
    for (const lab of samples) {
      if (model.domain && !model.domain(lab)) continue;
      const axes = model.fromLab(lab);
      assert.equal(axes.length, 3, `${model.id} axes length`);
      for (const v of axes) assert.ok(Number.isFinite(v), `${model.id} axis not finite: ${v}`);
      const back = model.toLab(axes);
      const tol = model.tol || 1e-6;
      assert.ok(Math.abs(back.L - lab.L) < tol, `${model.id} L ${back.L} vs ${lab.L}`);
      assert.ok(Math.abs(back.a - lab.a) < tol, `${model.id} a ${back.a} vs ${lab.a}`);
      assert.ok(Math.abs(back.b - lab.b) < tol, `${model.id} b ${back.b} vs ${lab.b}`);
    }
  }
});

test('OKLCH model matches the canonical polar view', () => {
  const m = Models.get('oklch');
  for (const lab of samples) {
    const [L, C, H] = m.fromLab(lab);
    const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
    assert.ok(Math.abs(L - lch.L) < 1e-12);
    assert.ok(Math.abs(C - lch.C) < 1e-12);
    if (C > 1e-9) assert.ok(Math.min(Math.abs(H - lch.H), 360 - Math.abs(H - lch.H)) < 1e-9);
  }
});

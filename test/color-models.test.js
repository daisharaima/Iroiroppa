'use strict';

// The colour-model adapter contract (docs/COLOR.md). A model is a view over the
// canonical OKLab value; it must round-trip through OKLab. This test covers every
// registered model automatically, so a new model is covered the moment it is
// registered.

const test = require('node:test');
const assert = require('node:assert/strict');

const Models = require('../src/shared/color-models');
const Color = require('../src/shared/color');

// The user-visible rule: a model whose own light axis is a perceptual lightness
// (CIELAB L*, HelmGen L) guides, locks and prints that axis; an sRGB-referenced
// picker space (OKHSV/OKHSL/OKHWB) guides in OKLab L, because one V is a whole
// range of perceived lightness. `usesNativeLight` is the one place that decides it.
test('every model declares whether its light axis carries the lightness', () => {
  const expected = {
    oklch: true, oklab: true, cielab: true, cielch: true,
    helmgen: true, helmgenlch: true,
    okhsv: false, okhsl: false, okhwb: false,
  };
  for (const m of Models.list()) {
    assert.ok(m.lightSource === 'native' || m.lightSource === 'oklab', `${m.id} declares lightSource`);
    assert.equal(Models.usesNativeLight(m), expected[m.id], `${m.id} light source`);
    assert.equal(Models.lightAxis(m), m.axes.findIndex((a) => a.role === 'lightness'), `${m.id} light axis`);
  }
});

// A grey has no hue of its own; the pointer still has to land on the hue the ring
// was turned to, and each model spells that hue in its own units.
test('at zero chroma every hue model points at the anchored hue', () => {
  for (const id of ['oklch', 'cielch', 'helmgenlch', 'okhsv']) {
    const model = Models.get(id);
    if (!model) continue;
    const store = { L: 0.6, H: 210, lab: () => ({ L: 0.6, a: 0, b: 0 }) };
    const axes = Models.axesFor(model, store);
    // Raise the chroma a little: the colour must come out at the anchor's hue.
    axes[1] = model.dense ? 0.05 : model.axes[1].max * 0.1;
    const lab = model.toLab(axes);
    const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
    assert.ok(Math.abs(lch.H - 210) < 8, `${id}: H ${lch.H.toFixed(1)}`);
  }
});

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

test('model families filter without changing the canonical value', () => {
  assert.equal(Models.normalizeFamily('nope'), 'all');
  assert.deepEqual(Models.listForFamily('cielab').map((m) => m.id), ['cielab', 'cielch']);
  assert.equal(Models.defaultForFamily('cielab'), 'cielch');
  assert.ok(Models.listForFamily('all').length > Models.listForFamily('oklab').length);
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

test('the lineup is the OK family plus the two GenSpace views', () => {
  assert.deepEqual(Models.ids(), ['oklch', 'oklab', 'cielab', 'cielch', 'okhsv', 'okhsl', 'okhwb', 'helmgenlch', 'helmgen']);
  for (const gone of ['lab', 'hsv', 'hsl']) {
    assert.equal(Models.get(gone), null, `${gone} is deliberately not a model any more`);
  }
});

// The generic round-trip above is gated to sRGB (`domain`). GenSpace is also
// used for wide-gamut appearances, so pin the conditioning away from the
// near-black high-chroma corner no RGB gamut contains (`docs/COLOR.md`).
test('the GenSpace models round-trip high-chroma colours', () => {
  const samples = [
    Color.oklchToOklab(0.60, 0.30, 145), // the wide green an Adobe RGB document holds
    Color.oklchToOklab(0.55, 0.30, 265),
    Color.oklchToOklab(0.70, 0.25, 30),
    Color.oklchToOklab(0.45, 0.25, 300),
  ];
  for (const id of ['helmgenlch', 'helmgen']) {
    const model = Models.get(id);
    for (const lab of samples) {
      const back = model.toLab(model.fromLab(lab));
      assert.ok(Math.abs(back.L - lab.L) < 1e-5, `${id} L ${back.L} vs ${lab.L}`);
      assert.ok(Math.abs(back.a - lab.a) < 1e-5, `${id} a ${back.a} vs ${lab.a}`);
      assert.ok(Math.abs(back.b - lab.b) < 1e-5, `${id} b ${back.b} vs ${lab.b}`);
    }
  }
});

test('every hue model declares where its hue anchor applies', () => {
  for (const model of Models.list()) {
    if (model.hueIndex == null) continue;
    const axes = model.fromLab({ L: 0.5, a: 0, b: 0 });
    const achromatic = typeof model.isAchromatic === 'function'
      ? model.isAchromatic(axes)
      : Math.abs(axes[1] - model.axes[1].min) < 1e-9;
    assert.equal(achromatic, true, `${model.id} must call a neutral colour achromatic`);
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

test('every axis declares a role and every model derives three clean planes', () => {
  for (const model of Models.list()) {
    const lights = model.axes.filter((a) => a.role === 'lightness');
    assert.equal(lights.length, 1, `${model.id} needs exactly one lightness axis`);
    assert.ok(model.axes.some((a) => a.role === 'chroma'), `${model.id} needs a chroma axis`);
    const planes = Models.planesFor(model);
    assert.equal(planes.length, 3, `${model.id} planes`);
    const key = planes.map((p) => [...p].sort().join(',')).sort();
    assert.deepEqual(key, ['0,1,2', '0,1,2', '0,1,2'], `${model.id} planes are not a permutation`);
    if (model.hueIndex != null) {
      assert.equal(model.axes[model.hueIndex].role, 'hue', `${model.id} hue axis role`);
      assert.equal(planes[0][2], model.hueIndex, `${model.id}: the first plane is the fixed-hue slice`);
      assert.equal(planes[0][1], model.axes.findIndex((a) => a.role === 'chroma'), `${model.id}: chroma is vertical`);
      assert.equal(Models.lightAxis(model), model.axes.findIndex((a) => a.role === 'lightness'));
    }
  }
});

test('plane labels name the two free channels in display order', () => {
  assert.equal(Models.planeLabel(Models.get('oklch'), 0), 'L \u00d7 C');
  assert.equal(Models.planeLabel(Models.get('oklch'), 1), 'H \u00d7 C');
  assert.equal(Models.planeLabel(Models.get('oklch'), 2), 'H \u00d7 L');
  assert.equal(Models.planeLabel(Models.get('okhsv'), 0), 'V \u00d7 S');
});

test('the OKLCH chroma axis can reach the working gamut', () => {
  const store = { cmax: () => 0.6 };
  assert.deepEqual(Models.axisRange(Models.get('oklch'), 1, store), { min: 0, max: 0.6 });
  assert.deepEqual(Models.axisRange(Models.get('oklch'), 1), { min: 0, max: 0.4 });
  assert.deepEqual(Models.axisRange(Models.get('okhsv'), 1, store), { min: 0, max: 1 });
});

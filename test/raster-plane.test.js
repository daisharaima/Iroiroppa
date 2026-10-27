'use strict';

// The plane rasteriser (src/shared/raster-plane.js) against the loop it replaced.
// The picture must not change when a map gets cheaper: same pixels for the sRGB
// window, and the same "shown == pickable" alpha except right on the gamut edge,
// where the gamma LUT quantises the test by ~1e-4.

const test = require('node:test');
const assert = require('node:assert');
const Color = require('../src/shared/color');
const Models = require('../src/shared/color-models');
const Raster = require('../src/shared/raster-plane');

const W = 64;
const H = 48;

function rangesOf(model) {
  return model.axes.map((a) => ({ min: a.min, max: a.max }));
}

/** The previous per-pixel loop, kept as the reference. */
function reference(model, plane, fixed, ranges) {
  const [hi, vi] = Models.planesFor(model)[plane];
  const hr = ranges[hi];
  const vr = ranges[vi];
  const axes = fixed.slice();
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    axes[vi] = vr.min + (1 - y / (H - 1)) * (vr.max - vr.min);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      axes[hi] = hr.min + (x / (W - 1)) * (hr.max - hr.min);
      const lab = model.toLab(axes);
      const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
      if (!Color.inGamut(lch.L, lch.C, lch.H)) { out[i + 3] = 0; continue; }
      const f = Color.fitToSrgb(lch.L, lch.C, lch.H);
      out[i] = Math.round(Math.max(0, Math.min(1, f.r)) * 255);
      out[i + 1] = Math.round(Math.max(0, Math.min(1, f.g)) * 255);
      out[i + 2] = Math.round(Math.max(0, Math.min(1, f.b)) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

for (const id of ['cielab', 'cielch', 'helmgen', 'helmgenlch']) {
  test(`the ${id} plane matches the per-pixel loop`, () => {
    const model = Models.get(id);
    if (!model) return; // the vendored bundle is optional
    const ranges = rangesOf(model);
    const fixed = model.axes.map((a) => (a.min + a.max) / 2);
    for (let plane = 0; plane < 3; plane++) {
      const want = reference(model, plane, fixed, ranges);
      const got = Raster.renderPlane({ model, plane, fixed, ranges, width: W, height: H });
      let opaqueWant = 0;
      let edgeMisses = 0;
      let worstChannel = 0;
      for (let i = 0; i < want.length; i += 4) {
        const aWant = want[i + 3];
        const aGot = got[i + 3];
        if (aWant) opaqueWant += 1;
        if ((aWant === 0) !== (aGot === 0)) { edgeMisses += 1; continue; }
        if (!aWant) continue;
        for (let c = 0; c < 3; c++) worstChannel = Math.max(worstChannel, Math.abs(want[i + c] - got[i + c]));
      }
      assert.ok(worstChannel <= 2, `plane ${plane}: channel differs by ${worstChannel}`);
      assert.ok(edgeMisses <= opaqueWant * 0.02, `plane ${plane}: ${edgeMisses} edge mismatches`);
    }
  });
}

test('the gamma LUT stays under half a byte', () => {
  let worst = 0;
  for (let i = 0; i <= 100000; i++) {
    const x = i / 100000;
    worst = Math.max(worst, Math.abs(Raster.gamma(x) - Color.linearToSrgb(x)));
  }
  // 1.46e-3 gamma = 0.37/255: after rounding, a channel can only differ when it
  // lands on a .5 boundary (the plane test below allows that one step).
  assert.ok(worst < 2e-3, `worst ${worst}`);
});

test('one lab pixel matches the reference and is transparent out of gamut', () => {  const lab = { L: 0.6, a: 0.05, b: -0.02 };
  const px = new Uint8ClampedArray(4);
  Raster.pixelFromLab(lab, px);
  const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
  const f = Color.fitToSrgb(lch.L, lch.C, lch.H);
  assert.equal(px[3], 255);
  assert.ok(Math.abs(px[0] - Math.round(f.r * 255)) <= 1);
  assert.ok(Math.abs(px[1] - Math.round(f.g * 255)) <= 1);
  assert.ok(Math.abs(px[2] - Math.round(f.b * 255)) <= 1);
  // Far outside sRGB with no wide working gamut: nothing to paint.
  Raster.pixelFromLab({ L: 0.6, a: 0.5, b: 0 }, px);
  assert.equal(px[3], 0);
});

test('a nonlinear model is not mistaken for an affine one', () => {
  for (const id of ['cielab', 'helmgen', 'helmgenlch']) {
    const model = Models.get(id);
    if (!model) continue;
    assert.equal(Raster.affineToLab(model), null, `${id} must use its own toLab`);
  }
});

test('fill paints out-of-gamut pixels instead of leaving holes', () => {
  const model = Models.get('okhsv');
  const ranges = rangesOf(model);
  const fixed = model.axes.map((a) => (a.min + a.max) / 2);
  // Reject everything: every pixel is "out of the document gamut".
  const reject = () => false;
  const holes = Raster.renderPlane({ model, plane: 0, fixed, ranges, width: 8, height: 8, workingGamut: reject });
  const filled = Raster.renderPlane({ model, plane: 0, fixed, ranges, width: 8, height: 8, workingGamut: reject, fill: true });
  for (let i = 3; i < holes.length; i += 4) {
    assert.strictEqual(holes[i], 0, 'without fill an out-of-gamut pixel is a hole');
    assert.strictEqual(filled[i], 255, 'with fill it is an opaque stand-in (no pale band)');
  }
});

test('a colour past sRGB is clipped at full opacity, dimmed only when asked', () => {
  // A wide-gamut document colour: inside the working gamut, outside sRGB.
  const lab = { L: 0.59, a: 0.25, b: -0.2 };
  const keep = () => true;
  const full = new Uint8ClampedArray(4);
  Raster.pixelFromLab(lab, full, keep);
  assert.strictEqual(full[3], 255, 'default: full opacity, no faded region');
  // Clipping keeps the saturation (like any drawing app); the chroma fit desaturates.
  const spread = (p) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  const dim = new Uint8ClampedArray(4);
  Raster.pixelFromLab(lab, dim, keep, 140);
  assert.strictEqual(dim[3], 140, 'marked: dimmed');
  assert.ok(spread(full) >= spread(dim), 'the clipped colour is at least as saturated as the fit');
  // Outside the document gamut it is still a hole (the slice shows what it can pick).
  const hole = new Uint8ClampedArray(4);
  Raster.pixelFromLab(lab, hole, () => false);
  assert.strictEqual(hole[3], 0, 'out of the document gamut stays a hole');
});

test('the luma field carries the model\'s own lightness, in its own units', () => {
  const G = require('../src/shared/slice-geometry');
  for (const id of ['okhsv', 'cielab', 'helmgen']) {
    const model = Models.get(id);
    if (!model) continue;
    const ranges = rangesOf(model);
    const fixed = model.axes.map((a) => (a.min + a.max) / 2);
    const luma = new Float32Array(W * H).fill(-1);
    Raster.renderPlane({ model, plane: 0, fixed, ranges, width: W, height: H, luma });
    const [hi, vi] = Models.planesFor(model)[0];
    let checked = 0;
    for (let y = 0; y < H; y += 7) {
      for (let x = 0; x < W; x += 5) {
        const idx = y * W + x;
        if (Number.isNaN(luma[idx])) continue; // unpainted
        const axes = fixed.slice();
        axes[hi] = ranges[hi].min + (x / (W - 1)) * (ranges[hi].max - ranges[hi].min);
        axes[vi] = ranges[vi].min + (1 - y / (H - 1)) * (ranges[vi].max - ranges[vi].min);
        const want = G.lightnessOf(model, axes);
        // Float32 storage: ~7 significant digits, so a CIELAB L* can differ by a
        // few 1e-6 from the Float64 computation.
        assert.ok(Math.abs(luma[idx] - want) < 1e-4, `${id} ${x},${y}: ${luma[idx]} vs ${want}`);
        checked += 1;
      }
    }
    assert.ok(checked > 10, `${id}: ${checked} painted samples`);
  }
});

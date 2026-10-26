'use strict';

// The generalised Ottosson conversions (src/shared/ottosson.js): one set of formulas,
// the cusp and the boundary taken from the cube they are given. The sRGB cube is the
// gate — the generalised code must reproduce the app's sRGB implementation — and the
// Adobe RGB cube is the reason it exists (colours sRGB cannot name).

const test = require('node:test');
const assert = require('node:assert');

const Color = require('../src/shared/color');
const Proof = require('../src/shared/proof');
const Ottosson = require('../src/shared/ottosson');

const M_ADOBE = [
  [0.5767309, 0.1855540, 0.1881852],
  [0.2973769, 0.6273491, 0.0752741],
  [0.0270343, 0.0706872, 0.9911085],
];

const srgbCube = () => Ottosson.create({
  toLinear: (lab) => { const l = Color.oklabToLinearRgb(lab.L, lab.a, lab.b); return [l.r, l.g, l.b]; },
  fromLinear: (rgb) => Color.linearRgbToOklab(rgb[0], rgb[1], rgb[2]),
});

const adobeProof = () => Proof.createProof({
  name: 'Adobe RGB (1998)',
  colorants: Proof.mulMat(Proof.BRADFORD_D65_D50, M_ADOBE),
  trc: { type: 'gamma', gamma: 563 / 256 },
}, 'working');

const adobeCube = () => {
  const proof = adobeProof();
  return { proof, cube: Ottosson.create({
    toLinear: (lab) => proof.oklabToLinearRecord(lab),
    fromLinear: (rgb) => proof.linearRecordToOklab(rgb),
  }) };
};

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('the sRGB cube reproduces the app\'s Okhsv (the generalisation gate)', () => {
  const g = srgbCube();
  let worst = 0;
  for (let h = 0; h < 360; h += 17) {
    for (let s = 0; s <= 1.0001; s += 0.15) {
      for (let v = 0.05; v <= 1.0001; v += 0.15) {
        const a = g.okhsvToOklab(h, s, v);
        const b = Color.okhsvToOklab(h, s, v);
        worst = Math.max(worst, Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b));
      }
    }
  }
  // Ottosson's `computeMaxSaturation` is itself a fit of the sRGB wall, so the exact
  // cusp differs from it by a few 1e-4 — the shapes agree, the numbers are sharper.
  assert.ok(worst < 3e-3, `worst Okhsv delta ${worst}`);
});

test('the sRGB cusp is the true gamut boundary, not Ottosson\'s fit', () => {
  const g = srgbCube();
  for (let h = 0; h < 360; h += 23) {
    const dir = (h * Math.PI) / 180;
    const c = g.cusp(Math.cos(dir), Math.sin(dir));
    const wall = Color.maxChroma(c.L, h);
    assert.ok(near(c.C, wall, 1e-6), `hue ${h}: cusp C ${c.C} vs wall ${wall}`);
  }
});

test('the sRGB cube round-trips Okhsv', () => {
  const g = srgbCube();
  for (let h = 0; h < 360; h += 13) {
    for (let s = 0.1; s <= 1; s += 0.3) {
      for (let v = 0.2; v <= 1; v += 0.3) {
        const lab = g.okhsvToOklab(h, s, v);
        const a = g.oklabToOkhsv(lab.L, lab.a, lab.b);
        const back = g.okhsvToOklab(a.h, a.s, a.v);
        assert.ok(near(lab.L, back.L, 1e-6) && near(lab.a, back.a, 1e-6) && near(lab.b, back.b, 1e-6), `okhsv ${h},${s},${v}`);
      }
    }
  }
});

test('Okhsl\'s S is monotone and continuous at a fixed hue and lightness', () => {
  const g = srgbCube();
  let last = -1;
  for (let s = 0; s <= 1.0001; s += 0.05) {
    const lab = g.okhslToOklab(210, s, 0.55);
    const C = Math.hypot(lab.a, lab.b);
    assert.ok(C >= last - 1e-9, `C dropped at s=${s}`);
    last = C;
  }
  assert.ok(last > 0.05, 'the hue actually has chroma');
});

test('the Adobe RGB cube reaches its own primaries (outside sRGB)', () => {
  const { proof, cube } = adobeCube();
  for (const [rgb, name] of [[[1, 0, 0], 'red'], [[0, 1, 0], 'green'], [[0, 0, 1], 'blue'], [[0, 1, 1], 'cyan']]) {
    const lab = proof.recordToOklab(rgb);
    for (const [toAxes, fromAxes, keys] of [
      ['oklabToOkhsv', 'okhsvToOklab', ['s', 'v']],
      ['oklabToOkhsl', 'okhslToOklab', ['s', 'l']],
    ]) {
      const a = cube[toAxes](lab.L, lab.a, lab.b);
      const p0 = a[keys[0]];
      const p1 = a[keys[1]];
      // A cube corner lands a few 1e-4 past the s=1 wall (the triangle approximation);
      // the axis clamps there, so judge the *reach* (S in 0..1) and that the other axis
      // (V for Okhsv, L for Okhsl) is a lightness inside 0..1.
      assert.ok(p0 > 0.99 && p0 < 1.01, `${name} ${toAxes}: ${keys[0]}=${p0}`);
      assert.ok(p1 >= 0 && p1 <= 1, `${name} ${toAxes}: ${keys[1]}=${p1}`);
      const back = cube[fromAxes](a.h, p0, p1);
      assert.ok(near(back.L, lab.L, 2e-6) && near(back.a, lab.a, 2e-6) && near(back.b, lab.b, 2e-6),
        `${name} ${toAxes} round-trip`);
    }
  }
});

test('the Adobe RGB cusp is the profile gamut boundary', () => {
  const { proof, cube } = adobeCube();
  for (let h = 0; h < 360; h += 29) {
    const dir = (h * Math.PI) / 180;
    const c = cube.cusp(Math.cos(dir), Math.sin(dir));
    const wall = proof.maxChroma(c.L, h, 0.6);
    assert.ok(near(c.C, wall, 1e-6), `hue ${h}: cusp ${c.C} vs wall ${wall}`);
  }
});

test('gamut-relative mode: S=1 is the document boundary, S=0.5 half of it', () => {
  // A stand-in for a LUT/CMYK proof: a smooth, hue-dependent boundary.
  const maxChroma = (L, H) => (L > 0 && L < 1 ? 0.25 * Math.sin(Math.PI * L) * (0.7 + 0.3 * Math.cos((H * Math.PI) / 180)) : 0);
  const g = Ottosson.gamutRelative({ maxChroma });
  for (const h of [0, 45, 120, 250, 330]) {
    for (const L of [0.2, 0.45, 0.7]) {
      const wall = maxChroma(L, h);
      const lab = g.okhsvToOklab(h, 1, L);
      const C = Math.hypot(lab.a, lab.b);
      // The boundary is cached on a 1 deg x 1/96 grid and interpolated, so S=1 lands on
      // the interpolated wall (about 1e-4 of the boundary, 0.01%).
      assert.ok(Math.abs(C - wall) <= Math.max(1e-6, wall * 1.5e-3), `h${h} L${L}: S=1 chroma ${C} vs wall ${wall}`);
      const half = g.okhsvToOklab(h, 0.5, L);
      assert.ok(Math.abs(Math.hypot(half.a, half.b) - wall / 2) <= Math.max(1e-6, wall * 1.5e-3), 'S=0.5 is half the boundary');
    }
  }
  // Round-trip and the black/white ends.
  for (const h of [10, 170, 300]) {
    const lab = g.okhsvToOklab(h, 0.6, 0.4);
    const a = g.oklabToOkhsv(lab.L, lab.a, lab.b);
    const back = g.okhsvToOklab(a.h, a.s, a.v);
    assert.ok(near(back.L, lab.L, 1e-9) && near(back.a, lab.a, 1e-9) && near(back.b, lab.b, 1e-9), 'gamut-relative round-trip');
    assert.strictEqual(Math.hypot(g.okhsvToOklab(h, 1, 0).a, g.okhsvToOklab(h, 1, 0).b), 0, 'black has no chroma');
  }
});

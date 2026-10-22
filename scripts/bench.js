'use strict';

// Headless micro-benchmarks for the drag and poll hot paths. Run with
// `npm run bench`. It is a rough guide, not a pass/fail gate; the numbers are
// recorded in docs/PERF.md.

const fs = require('node:fs');
const path = require('node:path');

const Color = require('../src/shared/color');
const Proof = require('../src/shared/proof');
const { parseColorState } = require('../src/main/companion/client');

const MAX_U32 = Color.MAX_U32;
const ICC = path.join(__dirname, '..', 'src', 'assets', 'synthetic.icc');

function time(label, iters, fn) {
  for (let i = 0; i < Math.min(iters, 200); i++) fn(i); // warm up
  const start = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn(i);
  const ns = Number(process.hrtime.bigint() - start);
  console.log(`${label.padEnd(32)} ${(ns / iters / 1000).toFixed(2).padStart(8)} µs/op   ${Math.round(iters / (ns / 1e9)).toString().padStart(8)} op/s`);
}

// --- colour maths (the drag hot path) ---------------------------------------
time('Color.inGamut', 200000, (i) => Color.inGamut(0.2 + (i % 60) / 100, 0.1, (i * 7) % 360));
time('Color.maxChroma', 20000, (i) => Color.maxChroma(0.2 + (i % 60) / 100, (i * 7) % 360));
time('Color.chromaIntervals', 20000, (i) => Color.chromaIntervals(0.2 + (i % 60) / 100, (i * 7) % 360));
time('Color.reduceChroma', 20000, (i) => Color.reduceChroma(0.5, 0.3, (i * 7) % 360));
time('Color.oklchToRgb', 200000, (i) => Color.oklchToRgb(0.6, 0.15, (i * 3) % 360));
time('Color.rgbToOklch', 200000, (i) => Color.rgbToOklch((i % 255) / 255, 0.4, 0.8));

// One silhouette rebuild (a plot-cache miss): 254 columns of intervals.
time('plot silhouette (254 cols)', 50, () => {
  for (let x = 0; x < 254; x++) Color.chromaIntervals(x / 253, 264.05);
});

// One supersampled raster plane for a non-OKLCH model (the phase's new path):
// each pixel is axes -> OKLab -> OKLCH (for the gamut test) -> RGB.
time('model raster plane (500²)', 3, () => {
  const inG = Color.inGamut;
  for (let y = 0; y < 500; y++) {
    const v = y / 499;
    for (let x = 0; x < 500; x++) {
      const lab = Color.okhsvToOklab((x / 499) * 360, v, 0.8);
      const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
      if (inG(lch.L, lch.C, lch.H)) Color.oklabToRgb(lab.L, lab.a, lab.b);
    }
  }
});

// One Color Wheel ring rebuild (300², the mid-drag device-pixel size): the
// saturation table then the per-pixel gamut test, the shape the wheel draw loop
// uses (`src/renderer/selector_module/color-wheel.js`). The old version asked
// the gamut for its max chroma once per ring pixel (~100 ms here); the
// 0.5 deg table keeps it well below that.
time('wheel ring rebuild (300²)', 5, () => {
  const L = 0.6, C_MAX = 0.4;
  const tab = new Float64Array(721);
  for (let k = 0; k < 721; k++) tab[k] = Math.min(C_MAX, Color.maxChroma(L, k / 2));
  const c = 150, ringOuter = c * 0.99, ringInner = c * 0.8;
  for (let y = 0; y < 300; y++) {
    for (let x = 0; x < 300; x++) {
      const dx = x - c, dy = y - c, dist = Math.hypot(dx, dy);
      if (dist < ringInner || dist > ringOuter) continue;
      const hue = Math.round((((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360) * 2) / 2;
      const lab = Color.oklchToOklab(L, tab[Math.round(hue * 2)], hue);
      const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
      Color.inGamut(lch.L, lch.C, lch.H);
    }
  }
});

// --- proof (the working-gamut path) -----------------------------------------
const profile = Proof.parseIcc(fs.readFileSync(ICC));
time('Proof.createProof', 500, () => Proof.createProof(profile, 'working'));
const proof = Proof.createProof(profile, 'working');
time('Proof.inGamut', 200000, (i) => proof.inGamut({ L: 0.5, C: 0.1, H: (i * 7) % 360 }));
time('Proof.maxChroma', 20000, (i) => proof.maxChroma(0.2 + (i % 60) / 100, (i * 7) % 360));
time('Proof.maxChromaBound (cached)', 200000, () => proof.maxChromaBound());

// The one-off stall when a working proof is first activated.
{
  const p = Proof.createProof(profile, 'working');
  const start = process.hrtime.bigint();
  p.maxChromaBound();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  console.log(`${'Proof.maxChromaBound (cold)'.padEnd(32)} ${ms.toFixed(1).padStart(8)} ms  (once per profile/model change)`);
}

// --- poll (one SyncColorCircleUIState read) ---------------------------------
const payload = {
  ColorSelectionModel: 'HSV',
  CurrentColorIndex: 0,
  HSVColorMainH: Math.round((180 / 360) * MAX_U32),
  HSVColorMainS: MAX_U32,
  HSVColorMainV: MAX_U32,
};
time('parseColorState', 200000, () => parseColorState(payload));

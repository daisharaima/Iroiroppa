'use strict';

// The culori cross-check (docs/STATE.md, §12.16).
//
// Proves Iroiroppa's own colour maths agrees with an independent, well-tested
// oracle — WITHOUT using culori as the oracle where its semantics differ. The
// gamut-interval core, the ICC proof transform and the gamut-tolerance rule are
// deliberately NOT cross-checked here: culori would encode the wrong behaviour,
// so nobody should "fix" this file toward culori.
//
// The suite skips itself if culori is not installed.

const test = require('node:test');
const assert = require('node:assert/strict');
const Color = require('../src/shared/color');

let culori = null;
try { culori = require('culori'); } catch { /* oracle unavailable */ }

/** A deterministic PRNG (mulberry32) — the same sample every run. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLES = (() => {
  const rnd = prng(0xC0FFEE);
  const out = [];
  const corners = [0, 0.5, 1];
  for (const r of corners) for (const g of corners) for (const b of corners) out.push([r, g, b]);
  for (let i = 0; i < 2000; i += 1) out.push([rnd(), rnd(), rnd()]);
  return out;
})();

function worstChannel(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

test('sRGB → OKLab agrees with culori within 1e-4', { skip: !culori }, () => {
  let worst = 0;
  let where = null;
  for (const [r, g, b] of SAMPLES) {
    const mine = Color.rgbToOklab(r, g, b);
    const ref = culori.oklab({ mode: 'rgb', r, g, b });
    const d = worstChannel([mine.L, mine.a, mine.b], [ref.l, ref.a, ref.b]);
    if (d > worst) { worst = d; where = [r, g, b]; }
  }
  assert.ok(worst < 1e-4, `worst ${worst} at ${where}`);
});

test('the hex helpers agree with culori for the same colour', { skip: !culori }, () => {
  let mismatches = 0;
  let where = null;
  for (const [r, g, b] of SAMPLES) {
    const mine = Color.rgb01ToHex(r, g, b);
    const ref = culori.formatHex({ mode: 'rgb', r, g, b });
    if (mine.toUpperCase() !== ref.toUpperCase()) { mismatches += 1; where = [mine, ref, r, g, b]; }
  }
  assert.equal(mismatches, 0, `first mismatch ${where}`);
});

test('OKLab ↔ OKLCH agrees on chroma (hue skipped near achromatic)', { skip: !culori }, () => {
  let worstC = 0;
  for (const [r, g, b] of SAMPLES) {
    const mine = Color.rgbToOklch(r, g, b);
    const ref = culori.oklch({ mode: 'rgb', r, g, b });
    worstC = Math.max(worstC, Math.abs(mine.C - ref.c));
    if (mine.C > 1e-4) {
      // hue only when it is defined; the app's hue anchor at C=0 is intentional
      let dh = Math.abs(((mine.H - ref.h) % 360 + 540) % 360 - 180);
      assert.ok(dh < 1e-2, `hue ${dh} at ${[r, g, b]}`);
    }
  }
  assert.ok(worstC < 1e-4, `worst C ${worstC}`);
});

test('Okhsl and Okhsv agree with culori within 1e-4', { skip: !culori }, () => {
  const hueGap = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
  let worst = 0;
  let where = null;
  for (const [r, g, b] of SAMPLES) {
    const lab = Color.rgbToOklab(r, g, b);
    const cases = [
      ['okhsl', Color.oklabToOkhsl(lab.L, lab.a, lab.b), culori.okhsl({ mode: 'rgb', r, g, b }), 'l'],
      ['okhsv', Color.oklabToOkhsv(lab.L, lab.a, lab.b), culori.okhsv({ mode: 'rgb', r, g, b }), 'v'],
    ];
    for (const [space, got, ref, third] of cases) {
      if (!ref || ref.s < 1e-4) continue;
      const d = Math.max(
        Math.abs(got.s - ref.s),
        Math.abs(got[third] - ref[third]),
        hueGap(got.h, ref.h) / 360,
      );
      if (d > worst) { worst = d; where = [space, got, ref]; }
    }
  }
  assert.ok(worst < 1e-4, `worst ${worst} at ${JSON.stringify(where)}`);
});

test('an in-gamut round trip is stable', { skip: !culori }, () => {
  for (const [r, g, b] of SAMPLES.slice(0, 500)) {
    const lab = Color.rgbToOklab(r, g, b);
    const back = Color.oklabToRgb(lab.L, lab.a, lab.b);
    const d = worstChannel([back.r, back.g, back.b], [r, g, b]);
    assert.ok(d < 1e-4, `round trip ${d} at ${[r, g, b]}`);
  }
});

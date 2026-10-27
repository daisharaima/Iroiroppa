'use strict';

// The wheel's hue rings (src/shared/ring.js): a hue wheel has to give every hue a
// distinct colour (no long flat arcs where a channel clip collapsed a range of hues
// into one sRGB primary) and has to follow the document's gamut.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const Proof = require('../src/shared/proof');
const Color = require('../src/shared/color');
const Ring = require('../src/shared/ring');

const M_ADOBE = [
  [0.5767309, 0.1855540, 0.1881852],
  [0.2973769, 0.6273491, 0.0752741],
  [0.0270343, 0.0706872, 0.9911085],
];

/** A store-shaped gamut (the ring only needs documentMaxChroma + a cache key). */
const storeFor = (proof) => ({
  key: proof ? proof.profile.name : 'srgb',
  plotKeyTag() { return this.key; },
  documentMaxChroma(L, H) { return proof ? proof.maxChroma(L, H, 0.6) : Color.maxChroma(L, H); },
});

const srgbStore = () => storeFor(null);
const adobeStore = () => storeFor(Proof.createProof({
  name: 'Adobe RGB (1998)',
  colorants: Proof.mulMat(Proof.BRADFORD_D65_D50, M_ADOBE),
  trc: { type: 'gamma', gamma: 563 / 256 },
}, 'working'));

// A narrow print-like gamut: the proof's own boundary, well inside sRGB.
const narrowStore = () => {
  const maxC = (L, H) => (L > 0 && L < 1 ? 0.08 * Math.sin(Math.PI * L) * (0.8 + 0.2 * Math.cos((H * Math.PI) / 180)) : 0);
  return { plotKeyTag: () => 'narrow', documentMaxChroma: maxC };
};

const rgbDelta = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)) * 255;

test('the outer ring never has a long flat arc (no "red takes so much space")', () => {
  for (const store of [srgbStore(), adobeStore(), narrowStore()]) {
    let worstStep = 0;
    let run = 1;
    let longest = 1;
    let runStart = Ring.outerColour(store, 0);
    for (let h = 1; h < 360; h += 1) {
      const c = Ring.outerColour(store, h);
      worstStep = Math.max(worstStep, rgbDelta(c, Ring.outerColour(store, h - 1)));
      // A run is broken when the colour has moved visibly from where the run started.
      if (rgbDelta(c, runStart) > 2) { run = 1; runStart = c; } else { run += 1; longest = Math.max(longest, run); }
    }
    assert.ok(longest <= 8, `${store.plotKeyTag()}: a ${longest}° arc has one colour`);
    assert.ok(worstStep < 40, `${store.plotKeyTag()}: a 1° step jumps ${worstStep}`);
  }
});

test('the ring follows the document gamut', () => {
  const srgb = srgbStore();
  const adobe = adobeStore();
  const narrow = narrowStore();
  let diffAdobe = 0;
  let diffNarrow = 0;
  for (let h = 0; h < 360; h += 10) {
    diffAdobe = Math.max(diffAdobe, rgbDelta(Ring.outerColour(srgb, h), Ring.outerColour(adobe, h)));
    diffNarrow = Math.max(diffNarrow, rgbDelta(Ring.outerColour(srgb, h), Ring.outerColour(narrow, h)));
  }
  assert.ok(diffAdobe > 2, `Adobe RGB differs from sRGB (${diffAdobe.toFixed(1)})`);
  assert.ok(diffNarrow > 40, `a narrow print gamut differs strongly (${diffNarrow.toFixed(1)})`);
});

test('on an sRGB cube the outer ring is the display edge at the (interpolated) cusp', () => {
  const store = srgbStore();
  const table = Ring.cuspLTable(store);
  for (const h of [0, 45, 120, 200, 300]) {
    const L = table[h];
    const want = Color.fitToSrgb(L, Color.maxChroma(L, h), h);
    const got = Ring.outerColour(store, h);
    assert.ok(Math.abs(got.r - want.r) < 1e-9 && Math.abs(got.g - want.g) < 1e-9 && Math.abs(got.b - want.b) < 1e-9,
      `hue ${h}`);
  }
});

test('the inner ring follows the selected lightness', () => {
  const store = adobeStore();
  const dark = Ring.innerColour(store, 30, 0.2);
  const light = Ring.innerColour(store, 30, 0.9);
  assert.ok(rgbDelta(dark, light) > 60, 'a dark and a light band differ');
  // The cusp cache is per store and per reference key, so a profile switch is not stale.
  const first = Ring.cusp(store, 30);
  store.key = 'other';
  const again = Ring.cusp(store, 30);
  assert.deepStrictEqual([...Object.values(again)], [...Object.values(first)]);
});

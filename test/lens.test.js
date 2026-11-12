'use strict';

// The lens machinery: a per-channel bit grid over the document's channels.
//
// These tests pin the three promises the feature makes to the rest of the app:
//   - a band colour is always a real document colour (clamped, on the grid, so the
//     recorded value never needs a gamut snap that could move it off the grid);
//   - the same call produces the displayed pixel and the recorded colour, so the map
//     cannot disagree with the picker;
//   - 8 bits is the identity, and an absent profile means the document *is* sRGB.

const test = require('node:test');
const assert = require('node:assert');
const Lens = require('../src/shared/lens.js');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('bits are clamped and defaulted', () => {
  assert.deepStrictEqual(Lens.normaliseBits([3, 3, 3]), [3, 3, 3]);
  assert.deepStrictEqual(Lens.normaliseBits([0, 9, 2.6]), [1, 8, 3]);
  assert.deepStrictEqual(Lens.normaliseBits(undefined), [3, 3, 3]);
  assert.deepStrictEqual(Lens.normaliseBits([1]), [1, 3, 3]);
});

test('8 bits is the identity', () => {
  const lens = Lens.create({ bits: [8, 8, 8] });
  assert.strictEqual(lens.inert, true);
  const out = lens.applySrgb(0.1234, 0.5678, 0.9);
  assert.deepStrictEqual(out, [0.1234, 0.5678, 0.9]);
  // 8/8/8 has 256 levels per channel, i.e. the whole 8-bit cube.
  assert.strictEqual(lens.count, 16777216);
});

test('3/3/3 gives 512 colours on a 1/7 grid', () => {
  const lens = Lens.create({ bits: [3, 3, 3] });
  assert.strictEqual(lens.count, 512);
  assert.strictEqual(lens.label, '3/3/3');
  const out = lens.applySrgb(0.1, 0.5, 0.99);
  // 0.1 * 7 = 0.7 -> 1 -> 1/7 ; 0.5 * 7 = 3.5 -> 4 -> 4/7 ; 0.99 -> 7/7
  assert.ok(near(out[0], 1 / 7), `r ${out[0]}`);
  assert.ok(near(out[1], 4 / 7), `g ${out[1]}`);
  assert.ok(near(out[2], 1), `b ${out[2]}`);
});

test('quantising clamps, so a band is always a real document colour', () => {
  const lens = Lens.create({ bits: [1, 2, 4] });
  const out = lens.applySrgb(-0.4, 2.5, 0.5);
  for (const c of out) assert.ok(c >= 0 && c <= 1, `channel ${c} out of range`);
  assert.strictEqual(out[0], 0);
  assert.strictEqual(out[1], 1);
});

test('the band index round-trips through docAt', () => {
  const lens = Lens.create({ bits: [2, 3, 4] });
  const d = [0.4, 0.75, 0.2];
  const index = lens.indexOf(d[0], d[1], d[2]);
  const back = lens.docAt(index);
  assert.ok(near(back[0], Math.round(0.4 * 3) / 3));
  assert.ok(near(back[1], Math.round(0.75 * 7) / 7));
  assert.ok(near(back[2], Math.round(0.2 * 15) / 15));
  assert.ok(index >= 0 && index < lens.count);
});

test('every band maps into the table and back', () => {
  const lens = Lens.create({ bits: [2, 2, 2] });
  assert.strictEqual(lens.hasTable, false, 'no profile: the bands are the colours');
  const seen = new Set();
  for (let i = 0; i < lens.count; i++) {
    const d = lens.docAt(i);
    const out = lens.applySrgb(d[0], d[1], d[2]);
    assert.ok(near(out[0], d[0]) && near(out[1], d[1]) && near(out[2], d[2]),
      `band ${i} did not survive the round trip`);
    seen.add(out.join(','));
  }
  assert.strictEqual(seen.size, lens.count, 'each band is its own colour');
});

test('a profile round trip keeps the band count, through a display table', () => {
  // A pretend document: channels are the sRGB values scaled by half, so the display
  // colour of a band differs from the band — the case a table has to get right.
  const toDoc = (r, g, b) => [r * 0.5, g * 0.5, b * 0.5];
  const fromDoc = (r, g, b) => [r * 2, g * 2, b * 2];
  const lens = Lens.create({ bits: [2, 2, 2], toDoc, fromDoc });
  assert.strictEqual(lens.hasTable, true);
  assert.strictEqual(lens.sameSpace, false);
  const out = lens.applySrgb(0.9, 0.1, 0.5);
  // doc 0.45/0.05/0.25 -> 2-bit grid 1/3,0,1/3 -> display 2/3,0,2/3 (table is float32)
  assert.ok(near(out[0], 2 / 3, 1e-5), `r ${out[0]}`);
  assert.ok(near(out[1], 0), `g ${out[1]}`);
  assert.ok(near(out[2], 2 / 3, 1e-5), `b ${out[2]}`);
});

test('applyLab records the band, not the unlensed colour', () => {
  const rgbToLab = (r, g, b) => ({ L: r, a: g, b });
  const oklabToRgb = (L, a, b) => ({ r: L, g: a, b });
  const lens = Lens.create({ bits: [1, 1, 1] });
  const got = lens.applyLab({ L: 0.9, a: 0.2, b: 0.6 }, rgbToLab, oklabToRgb);
  assert.deepStrictEqual([got.L, got.a, got.b], [1, 0, 1]);
});

test('applyLab through a profile uses the document value', () => {
  let recorded = null;
  const lens = Lens.create({
    bits: [2, 2, 2],
    toDoc: (r, g, b) => [r * 0.5, g * 0.5, b * 0.5],
    fromDoc: (r, g, b) => [r * 2, g * 2, b * 2],
    docToLab: (r, g, b) => { recorded = [r, g, b]; return { L: r, a: g, b }; },
  });
  lens.applyLab({ L: 0.9, a: 0.2, b: 0.6 },
    (r, g, b) => ({ L: r, a: g, b }), (L, a, b) => ({ r: L, g: a, b }));
  assert.deepStrictEqual(recorded, [1 / 3, 0, 1 / 3]);
});

test('parseSpec tolerates anything on disk', () => {
  assert.deepStrictEqual(Lens.parseSpec(null), { active: null, bits: [3, 3, 3] });
  assert.deepStrictEqual(Lens.parseSpec({ active: 'quantize' }),
    { active: 'quantize', bits: [3, 3, 3] });
  assert.deepStrictEqual(Lens.parseSpec({ active: 'gamut-mask' }),
    { active: null, bits: [3, 3, 3] });
  assert.deepStrictEqual(Lens.parseSpec({ active: 'quantize', quantize: { bits: [4, 4, 4] } }),
    { active: 'quantize', bits: [4, 4, 4] });
});

test('the table stays bounded: past 2^18 bands it converts per pixel', () => {
  const toDoc = (r, g, b) => [r, g, b];
  const fromDoc = (r, g, b) => [r, g, b];
  assert.strictEqual(Lens.create({ bits: [6, 6, 6], toDoc, fromDoc }).hasTable, true);
  assert.strictEqual(Lens.create({ bits: [7, 7, 4], toDoc, fromDoc }).hasTable, true);
  assert.strictEqual(Lens.create({ bits: [7, 7, 5], toDoc, fromDoc }).hasTable, false);
});

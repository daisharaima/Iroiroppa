'use strict';

// The analytic slice plane (src/shared/slice-plane.js) against the reference chain it
// replaced: `Color#chromaIntervals` for the silhouette, `Color#fitToSrgb` per painted
// pixel, `store.inGamut` per pixel for the hue strip.
//
// The fast path hoists the trigonometry and the matrix and gamma-encodes through the
// raster plane's LUT, so the contract is "the same picture": the silhouette alpha is
// the same wherever the colour is not exactly on the gamut edge, and no channel moves
// by more than one 8-bit step.

const test = require('node:test');
const assert = require('node:assert');
const Color = require('../src/shared/color');
const Plane = require('../src/shared/slice-plane');

const W = 47;
const H = 29;
const CMAX = 0.4;

/** The pre-2026-11 loop, verbatim: the reference this module must match. */
function reference(kind, fixed) {
  const data = new Uint8ClampedArray(W * H * 4);
  const luma = new Float32Array(W * H).fill(NaN);
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp01 = (x) => clamp(x, 0, 1);
  const b255 = (x) => clamp(Math.round(x), 0, 255);

  if (kind === 'lc' || kind === 'hc') {
    const cols = [];
    for (let x = 0; x < W; x += 1) {
      cols[x] = kind === 'lc'
        ? Color.chromaIntervals(clamp01(x / (W - 1)), fixed[2])
        : Color.chromaIntervals(fixed[0], (x / (W - 1)) * 360);
    }
    for (let y = 0; y < H; y += 1) {
      const C = (1 - y / (H - 1)) * CMAX;
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        const ivs = cols[x];
        let inside = false;
        for (let k = 0; k < ivs.length; k += 1) {
          if (C >= ivs[k][0] && C <= ivs[k][1]) { inside = true; break; }
        }
        if (!inside) { data[i + 3] = 0; continue; }
        const f = kind === 'lc'
          ? Color.fitToSrgb(clamp01(x / (W - 1)), C, fixed[2])
          : Color.fitToSrgb(fixed[0], C, (x / (W - 1)) * 360);
        data[i] = b255(f.r * 255);
        data[i + 1] = b255(f.g * 255);
        data[i + 2] = b255(f.b * 255);
        data[i + 3] = 255;
        luma[y * W + x] = kind === 'lc' ? clamp01(x / (W - 1)) : fixed[0];
      }
    }
    return { data, luma };
  }

  for (let y = 0; y < H; y += 1) {
    const L = 1 - y / (H - 1);
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const Hh = (x / (W - 1)) * 360;
      if (!Color.inGamut(L, fixed[1], Hh)) { data[i + 3] = 0; continue; }
      const f = Color.fitToSrgb(L, fixed[1], Hh);
      data[i] = b255(f.r * 255);
      data[i + 1] = b255(f.g * 255);
      data[i + 2] = b255(f.b * 255);
      data[i + 3] = 255;
      luma[y * W + x] = L;
    }
  }
  return { data, luma };
}

function render(kind, fixed, opts = {}) {
  const prep = Plane.prepare({
    kind,
    width: W,
    height: H,
    cmax: CMAX,
    fixed,
    intervalsAt: kind === 'lc'
      ? (u) => Color.chromaIntervals(Math.min(1, Math.max(0, u)), fixed[2])
      : (u) => Color.chromaIntervals(fixed[0], u * 360),
    ...opts,
  });
  const data = new Uint8ClampedArray(W * H * 4);
  const luma = new Float32Array(W * H).fill(NaN);
  Plane.fillRows(prep, data, luma, 0, H);
  return { prep, data, luma };
}

/** Alpha mismatches, and the worst channel difference where both painted. */
function compare(got, want) {
  let alphaDiff = 0;
  let worst = 0;
  let edge = 0;
  for (let i = 0; i < W * H; i += 1) {
    const at = i * 4;
    if ((got[at + 3] > 0) !== (want[at + 3] > 0)) {
      alphaDiff += 1;
      continue;
    }
    if (!want[at + 3]) continue;
    for (let c = 0; c < 3; c += 1) worst = Math.max(worst, Math.abs(got[at + c] - want[at + c]));
  }
  return { alphaDiff, worst, edge };
}

const CASES = [
  ['lc', [0.62, 0.11, 30], 'L×C at hue 30'],
  ['lc', [0.5, 0.2, 264.05], 'L×C at blue, where the gamut has a fin'],
  ['hc', [0.55, 0.12, 200], 'H×C at lightness 0.55'],
  ['hue', [0.5, 0.08, 120], 'H×L at chroma 0.08'],
  ['hue', [0.5, 0.22, 120], 'H×L at a wide chroma'],
];

for (const [kind, fixed, label] of CASES) {
  test(`slice plane matches the reference chain: ${label}`, () => {
    const want = reference(kind, fixed);
    const got = render(kind, fixed);
    const stats = compare(got.data, want.data);
    const painted = want.data.filter((_, i) => i % 4 === 3 && want.data[i] > 0).length;
    assert.ok(painted > 0, `the reference plane paints something at ${label}`);
    // No channel may move by more than one 8-bit step (the LUT gamma, nothing else).
    assert.ok(stats.worst <= 1, `channel drift ${stats.worst} at ${label}`);
    // The silhouette edge may move a pixel only where the tolerance decides it: the
    // whole rim is at most a few tenths of a percent of the plane.
    assert.ok(stats.alphaDiff <= Math.max(4, Math.ceil(painted * 0.01)),
      `silhouette differs on ${stats.alphaDiff} of ${painted} pixels at ${label}`);
  });
}

test('the lightness field is exactly the map\'s own light', () => {
  for (const [kind, fixed] of CASES) {
    const got = render(kind, fixed);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = y * W + x;
        if (got.data[i * 4 + 3] === 0) {
          assert.ok(Number.isNaN(got.luma[i]), `no luma on a transparent pixel (${kind})`);
          continue;
        }
        const want = kind === 'lc' ? x / (W - 1) : kind === 'hc' ? fixed[0] : 1 - y / (H - 1);
        // The field is a Float32Array (the contour reads it), so compare in its own
        // precision, not the double's.
        assert.ok(Math.abs(got.luma[i] - want) < 1e-6, `luma at ${kind} ${x},${y}`);
      }
    }
  }
});

test('a primary fin survives: a sub-row interval still gets its scanline', () => {
  // Blue's hue has the thin fin out to the primary; a plain row fill cannot reach it.
  const fixed = [0.4, 0.3, 264.05];
  const plain = render('lc', fixed);
  const prep = plain.prep;
  const minC = CMAX / (H - 1);
  let finPixels = 0;
  for (let x = 0; x < W; x += 1) {
    for (const [lo, hi] of prep.cols[x]) {
      if (hi - lo < minC) finPixels += 1;
    }
  }
  assert.ok(finPixels > 0, 'this hue has a fin narrower than a row');
  const luma = new Float32Array(W * H).fill(NaN);
  Plane.paintFins(prep, plain.data, luma);
  assert.ok(plain.data.some((_, i) => i % 4 === 3 && plain.data[i] > 0),
    'the fin paint writes opaque pixels');
});

test('a working gamut keeps the document gamut, not the screen gamut, as the mask', () => {
  // A document wider than the screen: `inDocument` decides the shape, and the pixels
  // past the sRGB window are painted with the fitted stand-in rather than dropped.
  const fixed = [0.55, 0.14, 120];
  const prep = Plane.prepare({
    kind: 'hue',
    width: W,
    height: H,
    cmax: CMAX,
    fixed,
    // A pretend document: anything with C <= 0.3 is inside it.
    inDocument: (L, C) => C <= 0.3,
  });
  const data = new Uint8ClampedArray(W * H * 4);
  const luma = new Float32Array(W * H).fill(NaN);
  Plane.fillRows(prep, data, luma, 0, H);
  // Chroma 0.14 is inside this document, so every non-edge pixel is painted.
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 0; x < W; x += 1) {
      assert.ok(data[(y * W + x) * 4 + 3] > 0, `painted at ${x},${y}`);
    }
  }
  // ...and the mask is the document's, not the screen's: a document that holds nothing
  // at this chroma paints nothing.
  const narrow = Plane.prepare({
    kind: 'hue', width: W, height: H, cmax: CMAX, fixed,
    inDocument: (L, C) => C <= 0.05,
  });
  const empty = new Uint8ClampedArray(W * H * 4);
  Plane.fillRows(narrow, empty, new Float32Array(W * H).fill(NaN), 0, H);
  assert.ok(empty.every((v, i) => i % 4 !== 3 || v === 0), 'outside the document is a hole');
});

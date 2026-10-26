'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Color = require('../src/shared/color');

test('known OKLCH values for sRGB primaries', () => {
  const red = Color.rgbToOklch(1, 0, 0);
  assert.ok(Math.abs(red.L - 0.6279) < 0.005, `red L=${red.L}`);
  assert.ok(Math.abs(red.C - 0.2577) < 0.005, `red C=${red.C}`);
  assert.ok(Math.abs(red.H - 29.23) < 0.2, `red H=${red.H}`);

  const white = Color.rgbToOklch(1, 1, 1);
  assert.ok(Math.abs(white.L - 1) < 1e-4, `white L=${white.L}`);
  assert.ok(white.C < 1e-4, `white C=${white.C}`);

  const black = Color.rgbToOklch(0, 0, 0);
  assert.ok(Math.abs(black.L) < 1e-6, `black L=${black.L}`);
  assert.ok(Math.abs(black.C) < 1e-6, `black C=${black.C}`);
});

test('OKLCH -> sRGB -> OKLCH round-trips', () => {
  const samples = [
    [0.82, 0.12, 217.2], // the reference image swatch
    [0.5, 0.15, 30],
    [0.7, 0.05, 120],
    [0.3, 0.1, 300],
    [0.95, 0.02, 0],
  ];
  for (const [L, C, H] of samples) {
    const { r, g, b } = Color.oklchToRgb(L, C, H);
    assert.ok(Color.inGamut(L, C, H), `sample ${L},${C},${H} should be in gamut`);
    const back = Color.rgbToOklch(r, g, b);
    assert.ok(Math.abs(back.L - L) < 1e-3, `L ${back.L} vs ${L}`);
    assert.ok(Math.abs(back.C - C) < 1e-3, `C ${back.C} vs ${C}`);
    assert.ok(Math.abs(back.H - H) < 0.5, `H ${back.H} vs ${H}`);
  }
});

test('maxChroma finds the in-gamut boundary', () => {
  for (const [L, H] of [[0.7, 200], [0.5, 30], [0.85, 100], [0.6, 300]]) {
    const m = Color.maxChroma(L, H);
    assert.ok(m > 0, `maxChroma(${L},${H}) should be > 0`);
    assert.ok(Color.inGamut(L, m, H), `boundary chroma must be displayable for ${L},${H}`);
    assert.ok(!Color.inGamut(L, m * 1.03 + 0.002, H), `just past the boundary must be out of gamut for ${L},${H}`);
  }
  assert.equal(Color.maxChroma(0, 100), 0);
  assert.equal(Color.maxChroma(1, 100), 0);
});

test('gamutMap reduces out-of-gamut chroma', () => {
  const mapped = Color.gamutMap(0.82, 0.4, 217.2);
  assert.ok(mapped.C < 0.4);
  assert.ok(Color.inGamut(mapped.L, mapped.C, mapped.H));
});

test('the gamut silhouette contains the sRGB primaries', () => {
  // Near the blue corner the in-gamut chroma is not a single interval: the body
  // ends well before the primary and the primary sits on a thin fin. The drawn
  // boundary must still reach it, or the primary looks unreachable.
  for (const rgb of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const p = Color.rgbToOklch(rgb[0], rgb[1], rgb[2]);
    assert.ok(Color.inGamut(p.L, p.C, p.H), `primary ${rgb} is in gamut`);
    const boundary = Color.maxChroma(p.L, p.H);
    assert.ok(boundary >= p.C - 1e-6, `boundary reaches primary ${rgb}: ${boundary} vs ${p.C}`);
  }
});

test('chromaIntervals reports disjoint in-gamut bands', () => {
  const blue = Color.rgbToOklch(0, 0, 1);
  const iv = Color.chromaIntervals(blue.L, blue.H);
  assert.ok(iv.length >= 2, 'the blue hue has a body plus a fin');
  for (let i = 0; i < iv.length; i++) {
    assert.ok(iv[i][0] < iv[i][1], 'interval is ordered');
    if (i > 0) assert.ok(iv[i][0] >= iv[i - 1][1] - 1e-12, 'intervals do not overlap');
    assert.ok(Color.inGamut(blue.L, (iv[i][0] + iv[i][1]) / 2, blue.H), `interval ${i} is in gamut`);
  }
  assert.ok(iv[iv.length - 1][1] >= blue.C - 1e-6, 'the outermost interval reaches the primary');
});

test('reduceChroma never raises chroma and lands in gamut', () => {
  const blue = Color.rgbToOklch(0, 0, 1);
  const body = Color.chromaIntervals(blue.L, blue.H)[0][1];
  const inBand = (body + blue.C) / 2;
  assert.ok(!Color.inGamut(blue.L, inBand, blue.H), 'the band between body and primary is out of gamut');
  const r = Color.reduceChroma(blue.L, inBand, blue.H);
  assert.ok(r <= inBand, `must not raise chroma (${r} <= ${inBand})`);
  assert.ok(Color.inGamut(blue.L, r, blue.H), 'result is in gamut');
  assert.equal(Color.reduceChroma(blue.L, body * 0.5, blue.H), body * 0.5, 'in-gamut chroma is kept');
});

test('hex parsing and formatting', () => {
  assert.deepEqual(Color.hexToRgb('#4DF7F8'), { r: 0x4d, g: 0xf7, b: 0xf8 });
  assert.deepEqual(Color.hexToRgb('4df7f8'), { r: 0x4d, g: 0xf7, b: 0xf8 });
  assert.deepEqual(Color.hexToRgb('#abc'), { r: 0xaa, g: 0xbb, b: 0xcc });
  assert.equal(Color.hexToRgb('nope'), null);
  assert.equal(Color.rgb01ToHex(0x4d / 255, 0xf7 / 255, 0xf8 / 255), '#4DF7F8');
  assert.equal(Color.rgbToHex(0x4d, 0xf7, 0xf8), '#4DF7F8');
  // Channels of exactly 0/1 must not be mistaken for 0..1 floats.
  assert.equal(Color.rgbToHex(0, 255, 1), '#00FF01');
  assert.equal(Color.rgbToHex(0, 255, 255), '#00FFFF');
});

test('HSV round-trips', () => {
  for (const [h, s, v] of [[0, 1, 1], [180, 1, 1], [217.2, 0.7, 0.9], [90, 0.4, 0.3]]) {
    const { r, g, b } = Color.hsvToRgb(h, s, v);
    const back = Color.rgbToHsv(r, g, b);
    assert.ok(Math.abs(back.h - h) < 0.01, `h ${back.h} vs ${h}`);
    assert.ok(Math.abs(back.s - s) < 1e-6, `s ${back.s} vs ${s}`);
    assert.ok(Math.abs(back.v - v) < 1e-6, `v ${back.v} vs ${v}`);
  }
});

test('uint32 helpers match the protocol scaling', () => {
  assert.equal(Color.u32ToUnit(4294967295), 1);
  assert.ok(Math.abs(Color.u32ToHue(Math.round(180 / 360 * 4294967295)) - 180) < 0.001);
});

// --- regressions found by the code review (2026-10) --------------------------------

test('gamutMap clamps lightness even at zero chroma', () => {
  assert.equal(Color.gamutMap(1.2, 0, 30).L, 1);
  assert.equal(Color.gamutMap(-0.4, 0, 30).L, 0);
});

test('inGamut agrees with chromaIntervals at the lightness ends', () => {
  // The gamut is a point at L=0 and L=1: a hair of chroma there is not displayable.
  assert.equal(Color.inGamut(0, 1e-5, 30), false);
  assert.deepEqual(Color.chromaIntervals(0, 30), []);
  assert.equal(Color.inGamut(1, 0, 30), true);
});

test('HSL of white is unsaturated', () => {
  const hsl = Color.rgbToHsl(1, 1, 1);
  assert.equal(hsl.s, 0);
  const back = Color.oklabToRgb(Color.rgbToOklab(1, 1, 1).L, Color.rgbToOklab(1, 1, 1).a, Color.rgbToOklab(1, 1, 1).b);
  assert.equal(Color.rgbToHsl(back.r, back.g, back.b).s, 0, 'a round-tripped white stays unsaturated');
});

test('an RGB grey stays under the store hue-anchor threshold', () => {
  const grey = Color.rgbToOklch(0.5, 0.5, 0.5);
  assert.ok(grey.C > 0, 'a converted grey still carries floating-point chroma');
  assert.ok(grey.C < 1e-6, `grey chroma ${grey.C} must stay under the store's 1e-6 gate`);
});

// --- fitToSrgb: the display stand-in for a colour the screen cannot show --------

test('fitToSrgb leaves a displayable colour exactly alone', () => {
  const a = Color.oklchToRgb(0.6, 0.1, 200);
  const b = Color.fitToSrgb(0.6, 0.1, 200);
  assert.equal(b.r, a.r);
  assert.equal(b.g, a.g);
  assert.equal(b.b, a.b);
});

test('fitToSrgb keeps the lightness of a colour outside sRGB', () => {
  // Inside Adobe RGB, outside sRGB at this lightness and hue.
  const L = 0.65, H = 150, C = 0.22;
  assert.equal(Color.inGamut(L, C, H), false, 'the sample must start out of sRGB');
  const f = Color.fitToSrgb(L, C, H);
  const back = Color.rgbToOklch(f.r, f.g, f.b);
  assert.ok(Math.abs(back.L - L) < 1e-6, `lightness ${back.L} must stay ${L}`);
  assert.ok(Math.abs(back.C - Color.reduceChroma(L, C, H)) < 1e-6, 'chroma lands on the sRGB edge');
  assert.ok(Color.inGamut(back.L, back.C, back.H), 'the stand-in is displayable');
});

test('a fixed-lightness hue edge is continuous at the sRGB blue primary', () => {
  // The wheel's hue ring uses this edge. The OKHSV S=1/V=1 path instead follows
  // the blue fin and jumps (green 61 -> 0) in a fraction of a degree.
  let prev = null;
  let maxStep = 0;
  for (let h = 250; h <= 290; h += 0.25) {
    const C = Color.maxChroma(0.7, h);
    const rgb = Color.oklchToRgb(0.7, C, h);
    if (prev) maxStep = Math.max(maxStep, Math.hypot(rgb.r - prev.r, rgb.g - prev.g, rgb.b - prev.b));
    prev = rgb;
  }
  assert.ok(maxStep < 0.1, `blue edge step ${maxStep.toFixed(3)} is a seam`);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Proof = require('../src/shared/proof');
const Color = require('../src/shared/color');
const { buildSyntheticIcc } = require('../src/shared/synthetic-icc');

// The profile the repo ships, built by `npm run icc` (src/assets/synthetic.icc):
// D50-adapted sRGB colourants and a gamma TRC. Tests use the committed bytes, so
// a fresh checkout exercises exactly what the app ships.
const ICC_PATH = path.join(__dirname, '..', 'src', 'assets', 'synthetic.icc');
const synthetic = Proof.parseIcc(fs.readFileSync(ICC_PATH));

const SAMPLES = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0.5], [0.82, 0.85, 0.9], [0.05, 0.6, 0.25]];
const maxErr = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

// The observations below use a real Adobe RGB (1998) profile when one can be
// found (Windows ships one). The parser and the transform themselves are covered
// by the synthetic fixture, so these tests never silently disappear on a fresh
// checkout.
const REAL_CANDIDATES = [
  path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'spool', 'drivers', 'color', 'AdobeRGB1998.icc'),
  'D:/Download/AdobeRGB1998.icc',
];
const realProfilePath = REAL_CANDIDATES.find((p) => fs.existsSync(p));

// --- matrix / profile parsing ----------------------------------------------

test('matrix inverse is exact', () => {
  const m = Proof.M_SRGB;
  const id = Proof.mulMat(m, Proof.inv3(m));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      assert.ok(Math.abs(id[i][j] - (i === j ? 1 : 0)) < 1e-9, `${i},${j} = ${id[i][j]}`);
    }
  }
});

test('ships a committed synthetic ICC the tests use', () => {
  const profile = Proof.parseIcc(fs.readFileSync(ICC_PATH));
  assert.equal(profile.deviceClass, 'mntr');
  assert.equal(profile.dataSpace, 'RGB ');
  assert.equal(profile.pcs, 'XYZ ');
  assert.ok(profile.colorants, 'colorants were parsed');
  assert.match(profile.description, /synthetic/i, `description "${profile.description}"`);
  // It must never be mistaken for a real working profile in any artifact.
  assert.doesNotMatch(profile.description, /adobe/i);
});

test('the committed ICC matches the generator', () => {
  assert.deepEqual(fs.readFileSync(ICC_PATH), buildSyntheticIcc());
});

test('parses a synthetic matrix/TRC profile', () => {
  const profile = Proof.parseIcc(buildSyntheticIcc({ description: 'Test Profile' }));
  assert.equal(profile.deviceClass, 'mntr');
  assert.equal(profile.dataSpace, 'RGB ');
  assert.equal(profile.pcs, 'XYZ ');
  assert.match(profile.version, /^2\./);
  assert.equal(profile.description, 'Test Profile');
  assert.ok(profile.colorants, 'colorants were parsed');
  assert.equal(profile.trc.type, 'gamma');
  assert.ok(Math.abs(profile.trc.gamma - 2.2) < 0.01, `gamma ${profile.trc.gamma}`);
  // Colorants are D50-adapted sRGB, so a colorimetric proof is the identity.
  const p = Proof.createProof(profile, 'colorimetric');
  for (const rgb of SAMPLES) {
    assert.ok(maxErr(p.writeSrgb(p.readOklch(rgb)), rgb) < 1e-3, `round-trip ${rgb}`);
  }
});

test('parseIcc rejects data that is not an ICC profile', () => {
  assert.throws(() => Proof.parseIcc(Buffer.alloc(200)), /not an ICC profile/);
});

test('pickAdobeRgbProfileName prefers a canonical Adobe RGB profile', () => {
  assert.equal(
    Proof.pickAdobeRgbProfileName(['Not A Colour Profile.icc', 'AdobeRGB1998.icc', 'foo.icc']),
    'AdobeRGB1998.icc',
  );
  assert.equal(Proof.pickAdobeRgbProfileName(['Adobe RGB (1998).icc']), 'Adobe RGB (1998).icc');
  assert.equal(Proof.pickAdobeRgbProfileName(['AdobeRGB1998.icm']), 'AdobeRGB1998.icm');
  // A non-canonical name still matches, but only if nothing better is present.
  assert.equal(Proof.pickAdobeRgbProfileName(['sRGB.icc', 'my-adobe-rgb.icc']), 'my-adobe-rgb.icc');
  assert.equal(Proof.pickAdobeRgbProfileName(['sRGB Color Space Profile.icm']), null);
  assert.equal(Proof.pickAdobeRgbProfileName([]), null);
  assert.equal(Proof.pickAdobeRgbProfileName(undefined), null);
});

test('createProof rejects a profile with no colorant matrix', () => {
  assert.throws(() => Proof.createProof({ trc: { type: 'identity' } }, 'working'), /colorant matrix/);
});

// --- transforms -------------------------------------------------------------

test('colorimetric proof to an sRGB-equivalent profile is the identity', () => {
  const p = Proof.createProof(synthetic, 'colorimetric');
  for (const rgb of SAMPLES) {
    const read = p.readOklch(rgb);
    const direct = Color.rgbToOklch(rgb[0], rgb[1], rgb[2]);
    assert.ok(Math.abs(read.L - direct.L) < 1e-4, `L ${read.L} vs ${direct.L}`);
    assert.ok(Math.abs(read.C - direct.C) < 1e-4, `C ${read.C} vs ${direct.C}`);
    assert.ok(Math.abs(read.H - direct.H) < 0.05, `H ${read.H} vs ${direct.H}`);
    assert.ok(maxErr(p.writeSrgb(read), rgb) < 1e-4, 'write round-trip');
    assert.ok(maxErr(p.displaySrgbFromContent(rgb), rgb) < 1e-4, 'display is identity');
  }
});

test('display model still round-trips through readOklch/writeSrgb', () => {
  const p = Proof.createProof(synthetic, 'display');
  for (const rgb of SAMPLES) {
    // An ICC stores its matrix and TRC as 16.16 / uint16 fixed point, so the
    // transform is not exact — a few 1e-4 near a primary is expected.
    const back = p.writeSrgb(p.readOklch(rgb));
    assert.ok(maxErr(back, rgb) < 5e-4, `round-trip ${rgb} -> ${back}`);
  }
});

test('proof-space encoding round-trips', () => {
  for (const model of ['colorimetric', 'display']) {
    const p = Proof.createProof(synthetic, model);
    for (const rgb of SAMPLES) {
      // Fixed-point ICC values make this approximate, not exact.
      assert.ok(maxErr(p.proofToSrgb(p.srgbToProof(rgb)), rgb) < 5e-4, `${model} ${rgb}`);
    }
  }
});

test('the working-space silhouette contains the blue corner fin', () => {
  // The same non-single-valued boundary exists in profile space: the body must
  // be joined by a fin out to the blue primary. (Red and green have no fin, so
  // only blue pins the behaviour.)
  const p = Proof.createProof(synthetic, 'working');
  const blue = Color.rgbToOklch(0, 0, 1);
  const iv = p.chromaIntervals(blue.L, blue.H);
  assert.ok(iv.length >= 2, 'the profile gamut has a fin at blue\'s hue');
  const boundary = p.maxChroma(blue.L, blue.H);
  assert.ok(boundary >= blue.C - 1e-3, `boundary reaches blue: ${boundary} vs ${blue.C}`);
  assert.ok(boundary > iv[0][1] + 0.01, 'the boundary is the fin, not the body');
});

test('working model treats recorded values as profile-space encodings', () => {
  const p = Proof.createProof(synthetic, 'working');
  const clamp = (v) => v.map((x) => Math.min(1, Math.max(0, x)));
  for (const rgb of SAMPLES) {
    // recorded -> appearance -> recorded is exact.
    assert.ok(maxErr(p.recordedSrgb(p.appearanceSrgb(rgb)), rgb) < 1e-6, `recorded round-trip ${rgb}`);
    // recorded -> OKLCH -> recorded passes through sRGB, so allow clipping noise.
    assert.ok(maxErr(clamp(p.writeSrgb(p.readOklch(rgb))), rgb) < 2e-3, `oklch round-trip ${rgb}`);
  }
});

// --- observations against a real wide-gamut profile -------------------------

test('working model reproduces the Adobe RGB observation', (t) => {
  if (!realProfilePath) { t.skip('no AdobeRGB1998.icc profile found'); return; }
  const p = Proof.createProof(Proof.parseIcc(fs.readFileSync(realProfilePath)), 'working');
  const to255 = (f) => f.map((v) => Math.min(255, Math.max(0, Math.round(v * 255))));
  // #BFFFFB as a recorded value decodes to the more saturated cyan CSP displays.
  const recorded = [0xbf / 255, 0xff / 255, 0xfb / 255];
  const shown = to255(p.appearanceSrgb(recorded));
  assert.ok(Math.abs(shown[0] - 0x9e) <= 2, `R ${shown[0]}`);
  assert.equal(shown[1], 0xff, `G ${shown[1]}`);
  assert.equal(shown[2], 0xfb, `B ${shown[2]}`);
  // recorded -> appearance -> recorded is exact.
  const back = to255(p.recordedSrgb(p.appearanceSrgb(recorded)));
  assert.ok(Math.abs(back[0] - 0xbf) <= 1 && back[1] === 0xff && Math.abs(back[2] - 0xfb) <= 1, `back ${back}`);
});

test('working-space gamut is wider than sRGB', (t) => {
  if (!realProfilePath) { t.skip('no AdobeRGB1998.icc profile found'); return; }
  const p = Proof.createProof(Proof.parseIcc(fs.readFileSync(realProfilePath)), 'working');
  // Adobe RGB is wider than sRGB in the greens, where the extra chroma shows up.
  for (const [L, H] of [[0.7, 142.5], [0.6, 142.5], [0.8, 142.5]]) {
    assert.ok(p.maxChroma(L, H) > Color.maxChroma(L, H) + 0.005, `working wider at L=${L} H=${H}`);
  }
});

test('parses the real Adobe RGB profile when present', (t) => {
  if (!realProfilePath) { t.skip('no AdobeRGB1998.icc profile found'); return; }
  const profile = Proof.parseIcc(fs.readFileSync(realProfilePath));
  assert.equal(profile.dataSpace, 'RGB ');
  assert.equal(profile.pcs, 'XYZ ');
  assert.ok(profile.description.trim().startsWith('Adobe RGB'));
  assert.equal(profile.trc.type, 'gamma');
  assert.ok(Math.abs(profile.trc.gamma - 2.2) < 0.01, `gamma ${profile.trc.gamma}`);
  assert.equal(profile.chad, undefined, 'profile has no chad tag');
  // Media white point is D65, while the colorant matrix white is the D50 PCS.
  assert.ok(Math.abs(profile.mediaWhite[2] - 1.08905) < 0.001, 'wtpt is D65');
  const white = [0, 1, 2].map((i) => profile.colorants[i][0] + profile.colorants[i][1] + profile.colorants[i][2]);
  assert.ok(Math.abs(white[0] - 0.9642) < 0.001 && Math.abs(white[2] - 0.8249) < 0.001, 'colorants are D50');
  const p = Proof.createProof(profile, 'colorimetric');
  for (const rgb of SAMPLES.slice(0, 4)) {
    assert.ok(maxErr(p.writeSrgb(p.readOklch(rgb)), rgb) < 1e-3, `round-trip ${rgb}`);
  }
});

// --- regressions found by the code review (2026-10) --------------------------------

test('white is inside the proof gamut, and a genuinely out-of-gamut colour is not', () => {
  const p = Proof.createProof(synthetic, 'colorimetric');
  // The record white is normalised to the profile's own white; before that, #FFFFFF
  // landed at rec ≈ (1, 1, 1.0006) and failed the 1e-5 relative tolerance.
  assert.equal(p.inGamut({ L: 1, C: 0, H: 0 }), true, 'white must be displayable');
  assert.equal(p.inGamut({ L: 0.6, C: 0.4, H: 30 }), false, 'still rejects a wide chroma');
});

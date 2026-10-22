'use strict';

// The CMYK proof path. It needs a real CMYK profile
// and the engine, so the tests skip on a machine without one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { bakeGrids, loadProfile } = require('../src/main/cmyk');
const Proof = require('../src/shared/proof');

const COLOUR_DIR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'spool', 'drivers', 'color');
const FOGRA = path.join(COLOUR_DIR, 'CoatedFOGRA39.icc');
const hasFogra = fs.existsSync(FOGRA);

test('the engine loads a real CMYK profile', { skip: !hasFogra }, () => {
  const loaded = loadProfile(fs.readFileSync(FOGRA));
  assert.equal(loaded.ok, true, loaded.error || '');
});

test('a baked profile soft-proofs through CMYK and back', { skip: !hasFogra }, () => {
  const grids = bakeGrids(fs.readFileSync(FOGRA), { size: 17, invSize: 9 });
  assert.equal(grids.forward.length, 17 * 17 * 17 * 4);
  assert.equal(grids.inverse.length, 9 * 9 * 9 * 9 * 3);

  const proof = Proof.createLutProof({ description: 'Coated FOGRA39', lut: grids });
  assert.equal(proof.kind, 'lut');

  const red = [1, 0, 0];
  const cmyk = proof.srgbToProof(red);
  assert.ok(cmyk[0] < 0.25, 'little cyan in red');
  assert.ok(cmyk[1] > 0.6 && cmyk[2] > 0.6, 'magenta and yellow dominate red');

  const shown = proof.appearanceSrgb(red);
  assert.ok(shown[0] > shown[1] && shown[0] > shown[2], 'red stays red');
  assert.ok(shown[1] < 0.6, 'and is desaturated by the print round trip');

  // A neutral is in gamut; a very saturated green is not.
  assert.equal(proof.inGamut({ L: 0.5, C: 0.01, H: 120 }), true);
  assert.equal(proof.inGamut({ L: 0.5, C: 0.5, H: 145 }), false);
  assert.ok(proof.maxChroma(0.5, 120) > 0.02, 'a grey has some headroom');
});

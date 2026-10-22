'use strict';

// CMYK profiles for the proof.
//
// The renderer has no build step and cannot `require` the engine, so the engine
// (jscolorengine, a main-process dependency) bakes two plain grids here and the
// renderer interpolates them (`src/shared/lut.js`). Baking is done once per
// selected profile and cached by the proof store.

const { Profile, Transform, eIntent, color } = require('jscolorengine');

const DEFAULT_SIZE = 17;   // sRGB -> CMYK grid points per axis
const DEFAULT_INV = 9;     // CMYK -> sRGB grid points per axis

const step = (i, n) => (n <= 1 ? 0 : (i / n) * 100); // 0..100 for the engine
const unit = (i, n) => (n <= 1 ? 0 : i / n);

/** Load an ICC buffer and report whether the engine accepts it. */
function loadProfile(buffer) {
  const profile = new Profile();
  try {
    profile.load(buffer);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (!profile.loaded) {
    const text = profile.lastError && profile.lastError.text ? profile.lastError.text : 'profile did not load';
    return { ok: false, error: text };
  }
  return { ok: true, profile };
}

/**
 * Bake the forward (sRGB -> CMYK) and inverse (CMYK -> sRGB) grids.
 * @param {Buffer} buffer an ICC profile
 * @returns {{ size:number, invSize:number, forward:number[], inverse:number[] }}
 */
function bakeGrids(buffer, { size = DEFAULT_SIZE, invSize = DEFAULT_INV } = {}) {
  const loaded = loadProfile(buffer);
  if (!loaded.ok) throw new Error(loaded.error);
  const { profile } = loaded;

  const fwd = new Transform();
  fwd.create('*sRGB', profile, eIntent.relative);
  const back = new Transform();
  back.create(profile, '*sRGB', eIntent.relative);

  const forward = new Float64Array(size * size * size * 4);
  let o = 0;
  for (let r = 0; r < size; r++) {
    for (let g = 0; g < size; g++) {
      for (let b = 0; b < size; b++) {
        const cmyk = fwd.transform(color.RGB(
          Math.round(step(r, size - 1) * 2.55),
          Math.round(step(g, size - 1) * 2.55),
          Math.round(step(b, size - 1) * 2.55),
        ));
        forward[o++] = (cmyk.C || 0) / 100;
        forward[o++] = (cmyk.M || 0) / 100;
        forward[o++] = (cmyk.Y || 0) / 100;
        forward[o++] = (cmyk.K || 0) / 100;
      }
    }
  }

  const inverse = new Float64Array(invSize * invSize * invSize * invSize * 3);
  let p = 0;
  for (let c = 0; c < invSize; c++) {
    for (let m = 0; m < invSize; m++) {
      for (let y = 0; y < invSize; y++) {
        for (let k = 0; k < invSize; k++) {
          const rgb = back.transform(color.CMYK(
            step(c, invSize - 1), step(m, invSize - 1), step(y, invSize - 1), step(k, invSize - 1),
          ));
          inverse[p++] = (rgb.R || 0) / 255;
          inverse[p++] = (rgb.G || 0) / 255;
          inverse[p++] = (rgb.B || 0) / 255;
        }
      }
    }
  }

  return {
    size,
    invSize,
    forward: Array.from(forward),
    inverse: Array.from(inverse),
  };
}

module.exports = { bakeGrids, loadProfile, DEFAULT_SIZE, DEFAULT_INV };

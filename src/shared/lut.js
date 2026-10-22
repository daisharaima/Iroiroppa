(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroLut = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

// N-dimensional grid interpolation for the CMYK proof.
//
// The CMYK engine (jscolorengine) is a main-process dependency — the renderer has
// no build step and cannot `require` it. So main bakes two plain grids (sRGB->CMYK
// and CMYK->sRGB) and the renderer interpolates them here. The grids are flat
// Float arrays; the first axis is the outermost, matching how main fills them.

/**
 * Multilinear interpolation of a flat grid.
 * @param {ArrayLike<number>} grid flat values, `size^dims * channels`
 * @param {number} size points per axis
 * @param {number} channels values per point
 * @param {number[]} coords `dims` values in 0..1 (clamped)
 * @returns {number[]} `channels` values
 */
function interp(grid, size, channels, coords) {
  const dims = coords.length;
  const n = size - 1;
  const lo = new Array(dims);
  const hi = new Array(dims);
  const f = new Array(dims);
  for (let d = 0; d < dims; d++) {
    const x = Math.min(Math.max(Number(coords[d]) || 0, 0), 1) * n;
    const i0 = Math.min(Math.floor(x), n - 1);
    lo[d] = Math.max(i0, 0);
    hi[d] = lo[d] + 1;
    f[d] = x - lo[d];
  }
  const out = new Array(channels).fill(0);
  const corners = 1 << dims;
  for (let mask = 0; mask < corners; mask++) {
    let w = 1;
    let idx = 0;
    for (let d = 0; d < dims; d++) {
      const bit = (mask >> d) & 1;
      w *= bit ? f[d] : (1 - f[d]);
      idx = idx * size + (bit ? hi[d] : lo[d]);
    }
    const base = idx * channels;
    for (let c = 0; c < channels; c++) out[c] += w * grid[base + c];
  }
  return out;
}

/** sRGB (0..1) -> the proof's channels (e.g. CMYK, 0..1). */
const interp3 = (grid, size, rgb) => interp(grid, size, 4, rgb);

/** The proof's channels (e.g. CMYK, 0..1) -> sRGB (0..1). */
const interp4 = (grid, size, cmyk) => interp(grid, size, 3, cmyk);

  return { interp, interp3, interp4 };
});

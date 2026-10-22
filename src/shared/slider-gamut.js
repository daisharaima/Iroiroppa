/*
 * Hard-edged in-gamut stops for a slider track.
 *
 * The track used to be built from 28 blended stops, so the boundary between the
 * coloured (in-gamut) part and the blank part faded over a sample. A crisp edge
 * needs two stops at the *same* percentage: the last colour before the boundary
 * and the blank immediately after it (or the reverse). This helper is pure so
 * the single-interval, multi-interval and all-in/all-out cases are testable.
 *
 * Loads as CommonJS in Node and as a global `IroSliderGamut` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroSliderGamut = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @param {Array<{t:number, inside:boolean, color:string}>} samples ordered 0..1
   * @param {string} blank the out-of-gamut colour (e.g. 'var(--blank)')
   * @returns {Array<{pct:number, color:string}>}
   */
  function trackStops(samples, blank = 'var(--blank)') {
    const out = [];
    if (!Array.isArray(samples) || !samples.length) return out;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const color = s.inside ? s.color : blank;
      if (i === 0) {
        out.push({ pct: s.t, color });
        continue;
      }
      const prev = samples[i - 1];
      if (s.inside !== prev.inside) {
        // Same percentage, two colours: no interpolation across the boundary.
        const before = prev.inside ? prev.color : blank;
        const after = s.inside ? s.color : blank;
        out.push({ pct: s.t, color: before });
        out.push({ pct: s.t, color: after });
      } else {
        out.push({ pct: s.t, color });
      }
    }
    return out;
  }

  /** A continuous full-track gradient (out-of-gamut marking off). */
  function fullStops(samples) {
    return (samples || []).map((s) => ({ pct: s.t, color: s.color }));
  }

  return { trackStops, fullStops };
});

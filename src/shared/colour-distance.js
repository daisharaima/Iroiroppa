'use strict';

// Helmlab's MetricSpace distance (docs/COLOR.md, "Distance").
//
// MetricSpace is Helmlab's trained colour-difference space — STRESS 22.48 on
// COMBVD against CIEDE2000's 29.20. Iroiroppa's canonical colour is OKLab, so
// these helpers take OKLab and convert through XYZ (D65) once per call.
//
// Nothing in the picker uses this yet: it exists so a future module (palette
// matching, nearest-colour ranking, a history dup-check that tolerates rounding)
// calls one documented function instead of inventing a ΔE. Never let it throw
// into a UI path — every entry point returns null on bad input.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./color'),
      require('../renderer/vendor/helmlab/helmlab.umd.js'),
    );
  } else {
    root.IroColourDistance = factory(root.Color, root.helmlab);
  }
})(typeof self !== 'undefined' ? self : this, function (Color, Helm) {
  // One JND = the pair the median observer calls at least "moderately different".
  const JND = 0.035633;

  const metric = Helm && Helm.Helmlab ? new Helm.Helmlab().metric : null;
  const space = metric ? metric.space : null;

  /** OKLab -> the raw MetricSpace triple, or null when the input is unusable. */
  function toMetric(lab) {
    if (!space || !lab) return null;
    const { L, a, b } = lab;
    if (!Number.isFinite(L) || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    const lin = Color.oklabToLinearRgb(L, a, b);
    const xyz = Color.linearRgbToXyz(lin.r, lin.g, lin.b);
    return space.fromXYZ([xyz.X, xyz.Y, xyz.Z]);
  }

  /**
   * Trained perceptual difference between two OKLab colours.
   * 0 for identical, ~0.15 and above for very dissimilar pairs (it saturates;
   * the *order* is preserved, so it is safe for ranking).
   */
  function difference(labA, labB) {
    const a = toMetric(labA);
    const b = toMetric(labB);
    if (!a || !b) return null;
    return space.distance(a, b);
  }

  /** The same difference in just-noticeable-difference units (<1 unnoticed, 1–2 subtle, >2 clear). */
  function jnd(labA, labB) {
    const d = difference(labA, labB);
    return d === null ? null : d / JND;
  }

  /** The nearest colour in `list` (OKLab objects), as `{ index, distance }`, or null. */
  function nearest(lab, list) {
    if (!space || !Array.isArray(list) || list.length === 0) return null;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i += 1) {
      const d = difference(lab, list[i]);
      if (d !== null && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best < 0 ? null : { index: best, distance: bestD };
  }

  return { difference, jnd, nearest, JND, available: Boolean(space) };
});

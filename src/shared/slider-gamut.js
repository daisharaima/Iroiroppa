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
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./color-models'), require('./color'));
  else root.IroSliderGamut = factory(root.IroColorModels, root.Color);
})(typeof self !== 'undefined' ? self : this, function (Models, Color) {
  'use strict';

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

  /** The axis range, letting an absolute-chroma axis reach the working gamut. */
  function axisRange(model, index, store) {
    const def = model.axes[index];
    if (store && def.absolute && def.role === 'chroma' && typeof store.cmax === 'function') {
      return { min: def.min, max: store.cmax() };
    }
    return { min: def.min, max: def.max };
  }

  /** Is the colour with axis `index` set to `value` inside the working gamut? */
  function inGamutAt(model, axes, index, value, store) {
    const tmp = axes.slice();
    tmp[index] = value;
    if (typeof model.inGamut === 'function') return model.inGamut(tmp);
    const lab = model.toLab(tmp);
    const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
    return store.inGamut(lch.L, lch.C, lch.H);
  }

  /** Nearest value on one axis that is in gamut, holding the other axes. */
  function nearestInGamut(model, index, store, axes, desired) {
    const r = axisRange(model, index, store);
    const v = clamp(desired, r.min, r.max);
    if (inGamutAt(model, axes, index, v, store)) return v;
    let best = v;
    let bestD = Infinity;
    const N = 96;
    for (let k = 0; k <= N; k += 1) {
      const s = r.min + (k / N) * (r.max - r.min);
      if (inGamutAt(model, axes, index, s, store)) {
        const d = Math.abs(s - v);
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    return bestD === Infinity ? v : best;
  }

  /**
   * A row's CSS gradient. `markOut` (default true) leaves the out-of-gamut part
   * blank, with a hard edge; false paints the whole track. The caller supplies
   * the current axes so the track reflects the other two channels.
   */
  function gradientFor(model, index, store, opts) {
    const o = opts || {};
    const axes = o.axes || Models.axesFor(model, store);
    const r = axisRange(model, index, store);
    const tmp = axes.slice();
    const N = o.samples || 64;
    const showOut = o.markOut !== false;
    const samples = [];
    for (let k = 0; k <= N; k += 1) {
      const t = k / N;
      const v = r.min + t * (r.max - r.min);
      tmp[index] = v;
      const lab = model.toLab(tmp);
      const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
      const f = Color.fitToSrgb(lch.L, lch.C, lch.H);
      const inside = typeof model.inGamut === 'function'
        ? model.inGamut(tmp)
        : store.inGamut(lch.L, lch.C, lch.H);
      samples.push({
        t,
        inside: showOut ? inside : true,
        color: `rgb(${clamp(f.r * 255, 0, 255)},${clamp(f.g * 255, 0, 255)},${clamp(f.b * 255, 0, 255)})`,
      });
    }
    const stops = showOut ? trackStops(samples, 'var(--blank)') : fullStops(samples);
    const dir = o.direction || '90deg';
    return `linear-gradient(${dir}, ${stops.map((s) => `${s.color} ${(s.pct * 100).toFixed(2)}%`).join(',')})`;
  }

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

  return { trackStops, fullStops, axisRange, inGamutAt, nearestInGamut, gradientFor };
});

/*
 * The Color Disc's mapping: a hue angle and a radius onto the model's axes, and back.
 *
 * The disc draws hue by angle and chroma by radius at one fixed light axis. That is
 * the polar form of a space, so a rectangular model (OKLab, CIELAB, HelmGen) and its
 * polar twin (OKLCH, CIELCH, HelmGen LCH) draw the *same* disc — the only difference
 * is the numbers the footer prints. The module's model list keeps one of each pair.
 *
 * `axesAt` and `pointFromAxes` must stay exact inverses: the pointer is drawn with
 * the latter and the pick with the former, so a mismatch puts the pointer somewhere
 * the click does not go. The pointer's radius is `chroma / rim` — never a chroma
 * re-derived at another lightness (that used to collapse to 0 and snap the pointer
 * to the centre for some hues).
 *
 * Loads as CommonJS in Node and as a global `IroDiscMap` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./color'), require('./color-models'));
  } else {
    root.IroDiscMap = factory(root.Color, root.IroColorModels);
  }
})(typeof self !== 'undefined' ? self : this, function (Color, Models) {
  'use strict';

  // Reference lightnesses (OKLab L) used to find the disc's rim in model units.
  const DISC_REFS = [0.35, 0.5, 0.65, 0.8];
  const rimCache = new Map();

  /** The plane the disc draws: its fixed axis is the light axis. */
  function discPlane(model) {
    const planes = Models.planesFor(model);
    const li = Models.lightAxis(model);
    const found = planes.findIndex((p) => p[2] === li);
    return found >= 0 ? found : 1;
  }

  /**
   * The disc's rim in model units: 1 for the dense models, the widest hue's chroma
   * *in the model's own axis units* otherwise. Fixed across lightness so the pointer
   * does not slide radially when the light axis moves; the current L's silhouette
   * can shrink inside it but never clip.
   */
  function rimFor(model, store) {
    if (model.dense) return 1;
    const key = `${store.plotKeyTag()}:${model.id}`;
    const hit = rimCache.get(key);
    if (hit !== undefined) return hit;
    let maxC = 0;
    for (const L of DISC_REFS) {
      for (let i = 0; i < 90; i += 1) {
        const H = (i / 90) * 360;
        // The gamut body, not the thin primary fin: a fin's far end would set the
        // rim and leave every other hue looking shrunken.
        const ivs = typeof store.chromaIntervals === 'function' ? store.chromaIntervals(L, H) : [];
        const C = ivs.length ? ivs[0][1] : store.maxChroma(L, H);
        if (!(C > 0)) continue;
        const at = model.fromLab(Color.oklchToOklab(L, C, H));
        maxC = Math.max(maxC, model.hueIndex == null ? Math.hypot(at[1], at[2]) : at[1]);
      }
    }
    const scale = maxC > 1e-6 ? maxC : model.axes[1].max;
    if (rimCache.size > 8) rimCache.clear();
    rimCache.set(key, scale);
    return scale;
  }

  /** Model axes for a disc point (hue degrees, radius 0..1). */
  function axesAt(model, axes, hue, r, scale) {
    const out = axes.slice();
    if (model.hueIndex == null) {
      // A rectangular model has no hue axis: the disc angle is the a/b angle.
      const rad = (hue * Math.PI) / 180;
      const C = r * scale;
      out[1] = C * Math.cos(rad);
      out[2] = C * Math.sin(rad);
      return out;
    }
    out[model.hueIndex] = hue;
    out[1] = model.dense ? r * model.axes[1].max : r * scale;
    return out;
  }

  /**
   * The disc position of a colour: the exact inverse of `axesAt`.
   * @returns {{hue:number, r:number, clamped:boolean}} `clamped` when the colour is
   *          past the rim or outside the working gamut (the pointer's outline state).
   */
  function pointFromAxes(model, axes, scale, store) {
    const hue = model.hueIndex == null
      ? ((Math.atan2(axes[2], axes[1]) * 180) / Math.PI + 360) % 360
      : axes[model.hueIndex];
    const rawC = model.hueIndex == null ? Math.hypot(axes[1], axes[2]) : axes[1];
    const denom = model.dense ? model.axes[1].max : scale;
    const r = denom > 0 ? Math.min(1, Math.max(0, rawC / denom)) : 0;
    let clamped = rawC > denom + 1e-9;
    if (!clamped && store) {
      const lab = model.toLab(axes);
      const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
      clamped = !store.inGamut(lch.L, lch.C, lch.H);
    }
    return { hue, r, clamped };
  }

  return { discPlane, rimFor, axesAt, pointFromAxes };
});

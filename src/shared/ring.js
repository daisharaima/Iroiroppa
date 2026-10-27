/*
 * The wheel's hue rings, as data (shared so a Node test can check them).
 *
 * A hue ring has to answer two questions at every angle: "what is the most colourful
 * colour this *document* can hold at this hue?" (the outer band) and "what is the same
 * hue at the currently selected lightness?" (the inner band).
 *
 * The old ring drew the document's max chroma at a fixed lightness and **clipped** it
 * to sRGB. On a wide-gamut document long arcs of different hues all clipped to the same
 * sRGB primary (a huge flat red band), and every profile clipped to that same edge, so
 * the ring never changed. Here the outer band uses the hue's **cusp** (the lightness
 * where the document's gamut is widest, found by a tiny scan) and both bands map with
 * `Color.fitToSrgb` — hue and lightness kept, chroma reduced to the display edge — so
 * neighbouring hues always differ and the profile shows through (cusp lightness,
 * saturation of a narrow print gamut).
 *
 * Loads as CommonJS in Node and as a global `IroRing` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./color'));
  } else {
    root.IroRing = factory(root.Color);
  }
})(typeof self !== 'undefined' ? self : this, function (Color) {
  'use strict';

  const CUSP_STEPS = 8;
  const CUSP_MIN_L = 0.08;
  const CUSP_MAX_L = 0.92;
  const FALLBACK_L = 0.7;
  // The cusp's lightness jumps where the gamut's supporting face changes (at a primary),
  // so sample it coarsely and interpolate: a 1° ring then has no seam at the primaries.
  const CUSP_ANCHORS = 24;

  /** A store's document gamut: the proof when one is active, else sRGB. */
  function gamutOf(store) {
    if (store && typeof store.documentMaxChroma === 'function') return store;
    return null;
  }

  const maxChroma = (store, L, H) => {
    if (store && typeof store.documentMaxChroma === 'function') return store.documentMaxChroma(L, H);
    return Color.maxChroma(L, H);
  };

  /** The cusp (widest chroma) at a hue, cached on the store per reference key. */
  function cusp(store, hue) {
    const key = `${store && typeof store.plotKeyTag === 'function' ? store.plotKeyTag() : 's'}:${hue}`;
    if (!store.__ringCusp) store.__ringCusp = new Map();
    const hit = store.__ringCusp.get(key);
    if (hit) return hit;
    let bestL = FALLBACK_L;
    let bestC = -1;
    for (let i = 0; i <= CUSP_STEPS; i += 1) {
      const L = CUSP_MIN_L + ((CUSP_MAX_L - CUSP_MIN_L) * i) / CUSP_STEPS;
      const C = maxChroma(store, L, hue);
      if (C > bestC) { bestC = C; bestL = L; }
    }
    const out = { L: bestL, C: Math.max(0, bestC) };
    if (store.__ringCusp.size > 2048) store.__ringCusp.clear();
    store.__ringCusp.set(key, out);
    return out;
  }

  /**
   * The cusp's lightness for every degree, from 24 anchors interpolated around the
   * circle: continuous in hue (a per-degree argmax jumps at the primaries).
   */
  function cuspLTable(store) {
    const key = store && typeof store.plotKeyTag === 'function' ? store.plotKeyTag() : 's';
    if (store.__ringL && store.__ringL.key === key) return store.__ringL.values;
    const anchors = new Float32Array(CUSP_ANCHORS);
    for (let i = 0; i < CUSP_ANCHORS; i += 1) anchors[i] = cusp(store, (i * 360) / CUSP_ANCHORS).L;
    const values = new Float32Array(360);
    for (let h = 0; h < 360; h += 1) {
      const t = (h / 360) * CUSP_ANCHORS;
      const i = Math.floor(t) % CUSP_ANCHORS;
      const f = t - Math.floor(t);
      values[h] = anchors[i] + (anchors[(i + 1) % CUSP_ANCHORS] - anchors[i]) * f;
    }
    store.__ringL = { key, values };
    return values;
  }

  /** The displayable colour for a lightness/chroma/hue (never clipped). */
  function display(L, C, H) {
    const f = Color.fitToSrgb(L, C, H);
    return { r: f.r, g: f.g, b: f.b };
  }

  /**
   * The outer band: the document's most colourful colour at this hue, mapped to sRGB.
   * The lightness is the (interpolated) cusp lightness, so adjacent hues always differ
   * and the profile shows through; the chroma is that lightness's boundary, so the ring
   * has no primary seams.
   * @returns {{r:number,g:number,b:number}} 0..1
   */
  function outerColour(store, hue) {
    const h = ((Math.round(hue) % 360) + 360) % 360;
    const L = cuspLTable(store)[h];
    return display(L, maxChroma(store, L, h), h);
  }

  /**
   * The inner band: the same hue at the selected lightness (`light`, the model's own
   * light axis), mapped to sRGB.
   */
  function innerColour(store, hue, light) {
    const L = Math.min(1, Math.max(0, Number.isFinite(light) ? light : FALLBACK_L));
    const C = maxChroma(store, L, hue);
    return display(L, C, hue);
  }

  return { cusp, cuspLTable, outerColour, innerColour, FALLBACK_L };
});

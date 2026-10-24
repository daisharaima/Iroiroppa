/*
 * Slice projections — how a 2D slice of the colour space is laid out on screen.
 *
 * A slice has two free axes: `u` runs along the horizontal axis (left -> right),
 * `v` along the vertical one (bottom -> top). The panel is the drawn box in
 * normalized coordinates (`x`,`y`, y down). A projection is a pure, invertible
 * map between the two — display-only, exactly like slice-view.js#rotate/flip:
 * the raster is drawn through `toScreen` and a press is mapped back through
 * `fromScreen`, so what is under the pointer is what gets picked.
 *
 *   flat     u -> x, v -> 1-y. Every slice.
 *   polar    angle = u (hue, clockwise from +x), radius = v (chroma). Needs a
 *            hue axis on `u` and a chroma-like axis on `v`.
 *   triangle the cusp frame: black, white and the hue's *cusp* are the three
 *            corners, so the apex slides with the hue (blue's cusp is dark,
 *            yellow's is light) and the gamut's own edge shows its curve. Needs
 *            the same axes as `polar`, and a cusp from findCusp().
 *
 * Loads as CommonJS in Node and as a global `IroProjection` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroProjection = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PROJECTIONS = ['flat', 'polar', 'triangle'];
  const TAU = Math.PI * 2;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const mod1 = (x) => ((x % 1) + 1) % 1;

  /** Which projections a slice can show, given its axes.
   *  - polar needs the hue on the horizontal axis and chroma on the vertical;
   *  - triangle needs the hue *held* (its slice) with chroma on the vertical. */
  function supports(kind, axes) {
    if (kind === 'flat') return true;
    if (!axes) return false;
    if (kind === 'polar') return Boolean(axes.hueHorizontal && axes.chromaVertical);
    if (kind === 'triangle') return Boolean(axes.hueFixed && axes.chromaVertical);
    return false;
  }

  const flat = {
    id: 'flat',
    toScreen: (u, v) => ({ x: u, y: 1 - v }),
    fromScreen: (x, y) => ({ u: x, v: 1 - y }),
  };

  const polar = {
    id: 'polar',
    toScreen(u, v) {
      const a = TAU * mod1(u);
      const r = 0.5 * clamp01(v);
      return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) };
    },
    /** null outside the disc: the mask says "this pixel has no slice point".
     *  At the exact centre there is no hue, so `u` comes back 0 — the caller
     *  keeps its hue anchor when `v` is ~0 (a hue has no meaning at chroma 0). */
    fromScreen(x, y) {
      const dx = x - 0.5;
      const dy = y - 0.5;
      const r = 2 * Math.hypot(dx, dy);
      // A pixel exactly on the rim lands at r = 1 +/- a float ulp: accept that
      // rather than punching a one-pixel hole at the edge.
      if (r > 1 + 1e-9) return null;
      return { u: mod1(Math.atan2(dy, dx) / TAU), v: Math.min(1, r) };
    },
  };

  // The panel corners of the cusp frame, in normalized panel coordinates.
  const TRI_K = { x: 0.10, y: 0.90 }; // black
  const TRI_W = { x: 0.10, y: 0.10 }; // white
  const TRI_APEX_X = 0.90; // the cusp; its height follows the cusp's lightness

  /**
   * The cusp frame for one slice. `cusp` is the slice-space point
   * `{ a, b }` (a 0..1 along the horizontal/lightness axis, b 0..1 normalized
   * chroma). Returns null when the cusp is degenerate (a slice with no chroma
   * anywhere), so the caller can fall back to `flat`.
   */
  function triangle(cusp) {
    if (!cusp) return null;
    const ac = clamp01(cusp.a);
    const bc = clamp01(cusp.b);
    if (!(bc > 1e-3)) return null;
    const apex = { x: TRI_APEX_X, y: TRI_K.y - 0.8 * ac };
    const e1 = { x: TRI_W.x - TRI_K.x, y: TRI_W.y - TRI_K.y };
    const e2 = { x: apex.x - TRI_K.x, y: apex.y - TRI_K.y };
    const det = e1.x * e2.y - e1.y * e2.x; // 0.64 for the fixed corners above
    if (!det) return null;
    return {
      id: 'triangle',
      cusp: { a: ac, b: bc },
      toScreen(a, b) {
        // Express the slice point in the frame's basis: along black->white (alpha)
        // and black->cusp (beta). The whole slice is drawn; the canvas clips.
        const beta = b / bc;
        const alpha = a - beta * ac;
        return {
          x: TRI_K.x + alpha * e1.x + beta * e2.x,
          y: TRI_K.y + alpha * e1.y + beta * e2.y,
        };
      },
      fromScreen(x, y) {
        const dx = x - TRI_K.x;
        const dy = y - TRI_K.y;
        const alpha = (dx * e2.y - dy * e2.x) / det;
        const beta = (e1.x * dy - e1.y * dx) / det;
        // Raw slice coordinates: the raster rejects anything outside 0..1 (so the
        // canvas outside the slice stays clear) and a pick clamps instead.
        return { u: alpha + beta * ac, v: beta * bc };
      },
    };
  }

  // The vertices of the fixed (barycentric) triangle: the saturated corner never
  // moves, because in Okhsv/Okhsl the slice square *is* the gamut — its s = 1 edge
  // is the hue's own boundary, so no cusp has to be found. This is the classic
  // picker: white top-left, black bottom-left, pure hue on the right.
  const FIXED_APEX = { x: 0.90, y: 0.50 };

  /**
   * The fixed triangle: (u, v) = (lightness/value, saturation) mapped by barycentric
   * weights onto white, black and the pure-hue corner. `u` is the slice's horizontal
   * axis and `v` its vertical one (the same convention as `triangle`). The inverse
   * returns raw u/v, so the raster rejects anything off the slice and a pick clamps.
   */
  function triangleFixed() {
    const W = TRI_W;
    const K = TRI_K;
    const S = FIXED_APEX;
    return {
      id: 'triangle-fixed',
      toScreen(u, v) {
        const sat = clamp01(v);
        const val = clamp01(u);
        const wS = sat * val;
        const wW = (1 - sat) * val;
        const wK = 1 - val;
        return {
          x: wW * W.x + wS * S.x + wK * K.x,
          y: wW * W.y + wS * S.y + wK * K.y,
        };
      },
      fromScreen(x, y) {
        const e1 = { x: W.x - K.x, y: W.y - K.y };
        const e2 = { x: S.x - K.x, y: S.y - K.y };
        const det = e1.x * e2.y - e1.y * e2.x;
        if (!det) return null;
        const dx = x - K.x;
        const dy = y - K.y;
        const wW = (dx * e2.y - dy * e2.x) / det;
        const wS = (e1.x * dy - e1.y * dx) / det;
        const u = wW + wS;
        return { u, v: u > 1e-9 ? wS / u : 0 };
      },
    };
  }

  /**
   * The cusp of a slice: the point of largest OKLab chroma.
   *
   * `sample(a)` returns `{ b, chroma }` for a normalized position `a` along the
   * horizontal axis (`b` normalized 0..1, `chroma` in OKLab units), or null where
   * the slice has no colour. A 33-point scan plus a golden-section refine keeps
   * it model-agnostic: it works for OKLCH (whose cusp sits inside the slice) and
   * for Okhsv/Okhsl (whose cusp is a corner at v = 1, s = 1).
   */
  function findCusp(sample, steps = 33) {
    let best = null;
    for (let i = 0; i <= steps; i += 1) {
      const a = i / steps;
      const s = sample(a);
      if (!s || !Number.isFinite(s.chroma)) continue;
      if (!best || s.chroma > best.chroma) best = { a, b: s.b, chroma: s.chroma };
    }
    if (!best) return null;
    // Golden-section refine on the chroma (the b at the refined a is resampled).
    let lo = Math.max(0, best.a - 1 / steps);
    let hi = Math.min(1, best.a + 1 / steps);
    const phi = (Math.sqrt(5) - 1) / 2;
    const f = (a) => {
      const s = sample(a);
      return s && Number.isFinite(s.chroma) ? s.chroma : -Infinity;
    };
    for (let i = 0; i < 24; i += 1) {
      const c = hi - phi * (hi - lo);
      const d = lo + phi * (hi - lo);
      if (f(c) > f(d)) hi = d; else lo = c;
    }
    const a = (lo + hi) / 2;
    const s = sample(a);
    return s ? { a, b: s.b, chroma: s.chroma } : best;
  }

  const byId = { flat, polar, triangle, triangleFixed };

  /**
   * Canvas-normalized -> the square a geometric projection lives in (a disc must
   * be a circle, not an ellipse). `aspect` is width / height; outside the square
   * the caller sees a coordinate below 0 or above 1 and drops the pixel.
   */
  function boxCoords(x, y, aspect) {
    const a = aspect > 0 ? aspect : 1;
    if (a >= 1) return { x: a * (x - 0.5) + 0.5, y };
    return { x, y: (y - 0.5) / a + 0.5 };
  }

  /** The exact inverse of boxCoords: square -> canvas-normalized. */
  function panelCoords(x, y, aspect) {
    const a = aspect > 0 ? aspect : 1;
    if (a >= 1) return { x: (x - 0.5) / a + 0.5, y };
    return { x, y: (y - 0.5) * a + 0.5 };
  }

  return { PROJECTIONS, supports, flat, polar, triangle, triangleFixed, findCusp, byId, boxCoords, panelCoords, TRI_K, TRI_W };
});

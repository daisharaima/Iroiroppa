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

  // The cusp frame's black/white side is the square mode's left edge: the two
  // left corners of the inscribed square (both on the ring's inner circle). The
  // moving cusp slides on the vertical line x = 0.9, so every hue's apex shares
  // that line while the black-white side stays put.
  const TRI_K = { x: 0.1464466094, y: 0.8535533906 }; // black, bottom-left
  const TRI_W = { x: 0.1464466094, y: 0.1464466094 }; // white, top-left
  const TRI_APEX_X = 0.90; // the cusp; its height follows the cusp's lightness
  // Okhsv's fixed triangle is equilateral and inscribed in the ring: all three
  // corners are on the circle, so its black/white side is that triangle's base
  // (not the square mode's edge; the user asked for square parity on Okhsl).
  const TRI_FIXED_K = { x: 0.25, y: 0.9330127019 };
  const TRI_FIXED_W = { x: 0.25, y: 0.0669872981 };
  const TRI_FIXED_APEX = { x: 1, y: 0.5 };
  /**
   * The cusp frame: the whole (lightness x chroma) square is mapped onto the
   * triangle black -> white -> cusp, so no colour is lost and the cusp always
   * sits at the apex. `cusp` is the slice-space point `{ a, b }` (a 0..1 along
   * the horizontal/lightness axis, b 0..1 normalized chroma).
   *
   * The grey axis is `G(v) = (1-v)K + vW`; the s = 1 boundary is
   * `B(v) = K + (v/ac)(A-K)` below the cusp and `A + ((v-ac)/(1-ac))(W-A)` above;
   * a point is `P(v,s) = G(v) + s(B(v)-G(v))`. Returns null when the cusp is
   * degenerate, so the caller can fall back to `flat`.
   */
  function triangle(cusp) {
    if (!cusp) return null;
    const ac = clamp01(cusp.a);
    const bc = clamp01(cusp.b);
    if (!(bc > 1e-3)) return null;
    const a = Math.min(0.999, Math.max(0.001, ac)); // keep the pieces non-singular
    const K = TRI_K;
    const W = TRI_W;
    const apex = { x: TRI_APEX_X, y: K.y + (W.y - K.y) * a };
    const gx = W.x - K.x, gy = W.y - K.y;
    const ax = apex.x - K.x, ay = apex.y - K.y;
    const wx = W.x - apex.x, wy = W.y - apex.y;
    const p = (v, s) => {
      const gxp = K.x + v * gx, gyp = K.y + v * gy;
      let bxp, byp;
      if (v <= a) {
        const t = v / a;
        bxp = K.x + t * ax; byp = K.y + t * ay;
      } else {
        const t = (v - a) / (1 - a);
        bxp = apex.x + t * wx; byp = apex.y + t * wy;
      }
      return { x: gxp + s * (bxp - gxp), y: gyp + s * (byp - gyp) };
    };
    return {
      id: 'triangle',
      cusp: { a: ac, b: bc },
      toScreen(u, v) {
        return p(clamp01(u), clamp01(v));
      },
      fromScreen(x, y) {
        // Barycentric weights (white, cusp, black) of the triangle.
        const dx = x - K.x, dy = y - K.y;
        const det = gx * ay - gy * ax;
        if (!det) return null;
        const wW = (dx * ay - dy * ax) / det;
        const wA = (gx * dy - gy * dx) / det;
        const wK = 1 - wW - wA;
        const inside = wW >= -1e-9 && wA >= -1e-9 && wK >= -1e-9;
        // Piece 1 (v <= a): v = wW + wA*a, s = wA*a / v.
        const v1 = wW + wA * a;
        const s1 = v1 > 1e-9 ? (wA * a) / v1 : 0;
        if (v1 >= -1e-9 && v1 <= a + 1e-9 && s1 >= -1e-9 && s1 <= 1 + 1e-9) {
          return { u: clamp01(v1), v: clamp01(s1), inside };
        }
        // Piece 2 (v >= a): q = 1 - wA - wK/(1-a), v = a + q(1-a), s = wA/(1-q).
        const q = 1 - wA - wK / (1 - a);
        const v2 = a + q * (1 - a);
        const s2 = 1 - q > 1e-9 ? wA / (1 - q) : 1;
        return { u: clamp01(v2), v: clamp01(s2), inside };
      },
    };
  }

  // The fixed (barycentric) triangle: the saturated corner never moves, because
  // in Okhsv the slice square *is* the gamut. Its vertices are the largest
  // equilateral triangle inscribed in the ring's inner circle, so all three
  // corners touch it.
  const FIXED_APEX = TRI_FIXED_APEX;

  /**
   * The fixed triangle: (u, v) = (lightness/value, saturation) mapped by
   * barycentric weights onto white, black and the pure-hue corner. `vertices`
   * is optional ({K,W,A}) so a caller can seat the frame wherever it needs;
   * the default is the ring's inscribed triangle.
   */
  function triangleFixed(vertices) {
    const W = (vertices && vertices.W) || TRI_FIXED_W;
    const K = (vertices && vertices.K) || TRI_FIXED_K;
    const S = (vertices && vertices.A) || FIXED_APEX;
    return {
      id: 'triangle-fixed',
      vertices: { K, W, A: S },
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
        const inside = wW >= -1e-9 && wS >= -1e-9 && 1 - wW - wS >= -1e-9;
        return { u: clamp01(u), v: u > 1e-9 ? clamp01(wS / u) : clamp01(wS), inside };
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

  /** Nearest point on a triangle (or the point itself when inside) in screen space. */
  function nearestOnTriangle(verts, x, y) {
    const [a, b, c] = verts;
    const side = (p1, p2) => (x - p2.x) * (p1.y - p2.y) - (p1.x - p2.x) * (y - p2.y);
    const d1 = side(a, b);
    const d2 = side(b, c);
    const d3 = side(c, a);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(hasNeg && hasPos)) return { x, y };
    let best = { x, y };
    let bestD = Infinity;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? clamp01(((x - p.x) * dx + (y - p.y) * dy) / len2) : 0;
      const px = p.x + t * dx;
      const py = p.y + t * dy;
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < bestD) { bestD = d; best = { x: px, y: py }; }
    }
    return best;
  }

  /**
   * The (u,v) a drag should pick for a screen point, kept inside the shape the
   * projection draws. Outside a triangle the affine inverse clamps its own axes, which
   * slides the pointer along one edge; the nearest in-shape point follows the cursor in
   * both axes instead.
   */
  function pickInside(proj, x, y) {
    const fallback = { u: clamp01(x), v: clamp01(1 - y), inside: false };
    if (!proj || typeof proj.fromScreen !== 'function') return fallback;
    const hit = proj.fromScreen(x, y);
    if (hit && hit.inside) return hit;
    if (typeof proj.toScreen === 'function') {
      const tri = [[0, 0], [1, 0], [1, 1]].map(([u, v]) => proj.toScreen(u, v));
      const q = nearestOnTriangle(tri, x, y);
      const back = proj.fromScreen(q.x, q.y);
      if (back) return { u: clamp01(back.u), v: clamp01(back.v), inside: false };
    }
    return hit ? { ...hit, inside: false } : fallback;
  }

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

  return { PROJECTIONS, supports, flat, polar, triangle, triangleFixed, findCusp, byId, pickInside, boxCoords, panelCoords, TRI_K, TRI_W, TRI_APEX_X, TRI_FIXED_K, TRI_FIXED_W, TRI_FIXED_APEX };
});

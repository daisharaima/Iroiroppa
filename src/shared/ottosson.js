/*
 * Ottosson's Okhsv / Okhsl / Okhwb, generalised to an arbitrary RGB cube.
 *
 * The sRGB versions live in color.js. They are the same FORMS — the cusp triangle, the
 * toe, the piecewise S curve — evaluated with sRGB's numbers: `computeMaxSaturation`
 * hard-codes sRGB's channel rows, `findGamutIntersection` hard-codes the same rows, and
 * `getStMid` is a polynomial fitted to sRGB's boundary. That is why they stop at sRGB.
 *
 * Here the numbers come from the cube the caller supplies:
 *   gamut = {
 *     toLinear(lab) -> [r, g, b],       // OKLab -> LINEAR document RGB (may leave the cube)
 *     fromLinear([r, g, b]) -> { L, a, b },
 *   }
 * The hue's cusp (the wall point farthest from grey) is found by a short bisection on
 * S, the gamut intersection reuses Ottosson's Halley step with the document's rows, and
 * the Okhsl control points are derived from the boundary instead of the sRGB fit:
 *   C0   = Ottosson's fixed shape (gamut-independent),
 *   Cmid = (C0 + Cmax) / 2.
 * The toe constants stay Ottosson's (they shape V <-> OKLab L, not the cube).
 *
 * With an sRGB gamut this module must reproduce color.js exactly; test/ottosson.test.js
 * is that gate. `gamutRelative` is the non-cube (CMYK / LUT) flavour: S is measured
 * against the document gamut's boundary at the current lightness and hue.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroOttosson = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PI = Math.PI;
  // Ottosson's toe (a fit of how OKLab L maps to the picker's value near black/white).
  const TOE_K1 = 0.206;
  const TOE_K2 = 0.03;
  const TOE_K3 = (1 + TOE_K1) / (1 + TOE_K2);
  const toe = (x) => 0.5 * (TOE_K3 * x - TOE_K1 + Math.sqrt((TOE_K3 * x - TOE_K1) ** 2 + 4 * TOE_K2 * TOE_K3 * x));
  const toeInv = (x) => (x * x + TOE_K1 * x) / (TOE_K3 * (x + TOE_K2));

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const mod360 = (x) => ((x % 360) + 360) % 360;
  const hueOf = (a, b) => mod360((0.5 + (0.5 * Math.atan2(-b, -a)) / PI) * 360);
  const labOf = (L, C, h) => {
    const r = (h * PI) / 180;
    return { L, a: C * Math.cos(r), b: C * Math.sin(r) };
  };

  // OKLab -> (l_, m_, s_) before the cube, Ottosson's own constants.
  const M1 = [
    [1, 0.3963377774, 0.2158037573],
    [1, -0.1055613458, -0.0638541728],
    [1, -0.0894841775, -1.2914855480],
  ];

  function inv3(m) {
    const [a, b, c] = m[0];
    const [d, e, f] = m[1];
    const [g, h, i] = m[2];
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (!det) throw new Error('singular matrix');
    return [
      [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
      [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
      [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
    ];
  }
  const M1INV = inv3(M1);
  const mul = (m, v) => [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];

  /**
   * @param {{toLinear: (lab) => number[], fromLinear: (rgb: number[]) => {L,a,b}}} gamut
   */
  function create(gamut) {
    // Each document channel as weights on (l^3, m^3, s^3): probe toLinear on the three
    // unit LMS directions, which is exact and needs no matrix from the caller.
    const cols = [0, 1, 2].map((j) => {
      const e = [0, 0, 0];
      e[j] = 1;
      const lab = mul(M1INV, e);
      return gamut.toLinear({ L: lab[0], a: lab[1], b: lab[2] });
    });
    const rows = [0, 1, 2].map((i) => [cols[0][i], cols[1][i], cols[2][i]]);

    const cuspCache = new Map();

    /** The chroma at L=1 where the cube's wall is first reached: a channel hits zero. */
    function maxSaturation(a_, b_) {
      const kl = M1[0][1] * a_ + M1[0][2] * b_;
      const km = M1[1][1] * a_ + M1[1][2] * b_;
      const ks = M1[2][1] * a_ + M1[2][2] * b_;
      const minChannel = (S) => {
        const l_ = 1 + S * kl;
        const m_ = 1 + S * km;
        const s_ = 1 + S * ks;
        const l = l_ * l_ * l_;
        const m = m_ * m_ * m_;
        const s = s_ * s_ * s_;
        let best = Infinity;
        for (let i = 0; i < 3; i += 1) {
          const w = rows[i];
          const v = w[0] * l + w[1] * m + w[2] * s;
          if (v < best) best = v;
        }
        return best;
      };
      let hi = 1;
      let guard = 0;
      while (minChannel(hi) > 0 && guard < 12) { hi *= 2; guard += 1; }
      if (!(minChannel(hi) <= 0)) return hi;
      let lo = 0;
      for (let i = 0; i < 40; i += 1) {
        const mid = (lo + hi) / 2;
        if (minChannel(mid) > 0) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }

    /** The gamut's cusp at a hue direction, cached per half-degree bucket. */
    function cusp(a_, b_) {
      // Cache on the rounded hue (0.05 deg) and compute at the bucket's *centre*, so every
      // caller in the bucket sees the same cusp (a cache that stored the first caller's
      // exact hue made the result depend on call order).
      const key = Math.round((Math.atan2(b_, a_) * 180) / PI * 20) + 7200;
      const hit = cuspCache.get(key);
      if (hit) return hit;
      const hr = (((key - 7200) / 20) * PI) / 180;
      const ca = Math.cos(hr);
      const cb = Math.sin(hr);
      const S = maxSaturation(ca, cb);
      const rgb = gamut.toLinear({ L: 1, a: S * ca, b: S * cb });
      const L = Math.cbrt(1 / Math.max(rgb[0], rgb[1], rgb[2], 1e-12));
      const out = { L, C: L * S };
      cuspCache.set(key, out);
      return out;
    }

    /** Where the segment (L0,C0) -> (L1,C1) leaves the cube (Ottosson's Halley step). */
    function gamutIntersection(a_, b_, L1, C1, L0, cp) {
      const kl = M1[0][1] * a_ + M1[0][2] * b_;
      const km = M1[1][1] * a_ + M1[1][2] * b_;
      const ks = M1[2][1] * a_ + M1[2][2] * b_;
      let t;
      if ((L1 - L0) * cp.C - (cp.L - L0) * C1 <= 0) {
        t = (cp.C * L0) / (C1 * cp.L + cp.C * (L0 - L1));
      } else {
        t = (cp.C * (L0 - 1)) / (C1 * (cp.L - 1) + cp.C * (L0 - L1));
        const dL = L1 - L0;
        const dC = C1;
        const ldt = dL + dC * kl;
        const mdt = dL + dC * km;
        const sdt = dL + dC * ks;
        const L = L0 * (1 - t) + t * L1;
        const C = t * C1;
        const l_ = L + C * kl;
        const m_ = L + C * km;
        const s_ = L + C * ks;
        const l = l_ * l_ * l_;
        const m = m_ * m_ * m_;
        const s = s_ * s_ * s_;
        const l3 = 3 * ldt * l_ * l_;
        const m3 = 3 * mdt * m_ * m_;
        const s3 = 3 * sdt * s_ * s_;
        const l6 = 6 * ldt * ldt * l_;
        const m6 = 6 * mdt * mdt * m_;
        const s6 = 6 * sdt * sdt * s_;
        const channel = (w) => {
          const f = w[0] * l + w[1] * m + w[2] * s - 1;
          const f1 = w[0] * l3 + w[1] * m3 + w[2] * s3;
          const f2 = w[0] * l6 + w[1] * m6 + w[2] * s6;
          const u = f1 / (f1 * f1 - 0.5 * f * f2);
          return u >= 0 ? -f * u : 1e6;
        };
        t += Math.min(channel(rows[0]), channel(rows[1]), channel(rows[2]));
      }
      return t;
    }

    /** Okhsl's control points at an (un-toed) lightness. */
    function getCs(L, a_, b_) {
      if (!(L > 0 && L < 1)) return { C0: 0, Cmid: 0, Cmax: 0 };
      const cp = cusp(a_, b_);
      const Cmax = gamutIntersection(a_, b_, L, 1, L, cp);
      // Ottosson's C0 shape, but the gamut sets the ceiling: on a narrow hue Cmax can be
      // smaller than his fixed C0, which would put the piecewise curve's control points
      // past the wall (a discontinuous S). Keep C0 < Cmid < Cmax.
      const base = Math.sqrt(1 / (1 / ((L * 0.4) ** 2) + 1 / (((1 - L) * 0.8) ** 2)));
      const C0 = Math.min(base, 0.5 * Cmax);
      const Cmid = Math.min(0.5 * (C0 + Cmax), 0.9 * Cmax);
      return { C0, Cmid, Cmax };
    }

    function okhsvToOklab(h, s, v) {
      const hr = (h / 180) * PI;
      const a_ = Math.cos(hr);
      const b_ = Math.sin(hr);
      const cp = cusp(a_, b_);
      const S_max = cp.C / cp.L;
      const T_max = cp.C / (1 - cp.L);
      const S_0 = 0.5;
      const k = 1 - S_0 / S_max;
      const denom = S_0 + T_max - T_max * k * s;
      const L_v = 1 - (s * S_0) / denom;
      const C_v = (s * T_max * S_0) / denom;
      let L = v * L_v;
      let C = v * C_v;
      const L_vt = toeInv(L_v);
      const C_vt = L_v ? (C_v * L_vt) / L_v : 0;
      const L_new = toeInv(L);
      C = L ? (C * L_new) / L : 0;
      L = L_new;
      const sc = gamut.toLinear(labOf(L_vt, C_vt, h));
      const scaleL = Math.cbrt(1 / Math.max(sc[0], sc[1], sc[2], 0, 1e-12));
      L *= scaleL;
      C *= scaleL;
      const lin = gamut.toLinear(labOf(L, C, h));
      return gamut.fromLinear([lin[0], lin[1], lin[2]]);
    }

    function oklabToOkhsv(L0, a, b) {
      const C0 = Math.hypot(a, b);
      const a_ = C0 > 1e-12 ? a / C0 : 0;
      const b_ = C0 > 1e-12 ? b / C0 : 0;
      const h = hueOf(a, b);
      if (C0 <= 1e-9) return { h, s: 0, v: toe(clamp01(L0)) };
      const cp = cusp(a_, b_);
      const S_max = cp.C / cp.L;
      const T_max = cp.C / (1 - cp.L);
      const S_0 = 0.5;
      const k = 1 - S_0 / S_max;
      const t = T_max / (C0 + L0 * T_max);
      const L_v = t * L0;
      const C_v = t * C0;
      const L_vt = toeInv(L_v);
      const C_vt = L_v ? (C_v * L_vt) / L_v : 0;
      const sc = gamut.toLinear({ L: L_vt, a: a_ * C_vt, b: b_ * C_vt });
      const scaleL = Math.cbrt(1 / Math.max(sc[0], sc[1], sc[2], 0, 1e-12));
      let L = L0 / scaleL;
      let C = C0 / scaleL;
      C = L ? (C * toe(L)) / L : 0;
      L = toe(L);
      const v = L_v ? L / L_v : 0;
      const s = ((S_0 + T_max) * C_v) / (T_max * S_0 + T_max * k * C_v);
      return { h, s, v };
    }

    function okhslToOklab(h, s, l) {
      const L = toeInv(clamp01(l));
      if (!s || L <= 0 || L >= 1) return { L, a: 0, b: 0 };
      const hr = (h / 180) * PI;
      const a_ = Math.cos(hr);
      const b_ = Math.sin(hr);
      const { C0, Cmid, Cmax } = getCs(L, a_, b_);
      let t, k0, k1, k2;
      if (s < 0.8) {
        t = 1.25 * s;
        k0 = 0;
        k1 = 0.8 * C0;
        k2 = 1 - k1 / Cmid;
      } else {
        t = 5 * (s - 0.8);
        k0 = Cmid;
        k1 = (0.2 * Cmid * Cmid * 1.25 * 1.25) / C0;
        k2 = 1 - k1 / (Cmax - Cmid);
      }
      const C = k0 + (t * k1) / (1 - k2 * t);
      return { L, a: C * a_, b: C * b_ };
    }

    function oklabToOkhsl(L0, a, b) {
      const l = toe(clamp01(L0));
      const C0 = Math.hypot(a, b);
      const h = mod360((Math.atan2(b, a) * 180) / PI);
      if (C0 <= 1e-12) return { h, s: 0, l };
      const a_ = a / C0;
      const b_ = b / C0;
      const { C0: c0, Cmid, Cmax } = getCs(L0, a_, b_);
      let s;
      if (C0 < Cmid) {
        const k1 = 0.8 * c0;
        const k2 = 1 - k1 / Cmid;
        const t = C0 / (k1 + k2 * C0);
        s = t * 0.8;
      } else {
        const k0 = Cmid;
        const k1 = (0.2 * Cmid * Cmid * 1.25 * 1.25) / c0;
        const k2 = 1 - k1 / (Cmax - Cmid);
        const t = (C0 - k0) / (k1 + k2 * (C0 - k0));
        s = 0.8 + 0.2 * t;
      }
      return { h, s, l };
    }

    function okhwbToOklab(h, w, b) {
      const v = 1 - clamp01(b);
      const s = v > 1e-9 ? clamp01(1 - clamp01(w) / v) : 0;
      return okhsvToOklab(h, s, v);
    }

    function oklabToOkhwb(L0, a, b) {
      const r = oklabToOkhsv(L0, a, b);
      return { h: r.h, w: r.v * (1 - r.s), b: 1 - r.v };
    }

    return {
      kind: 'cube',
      okhsvToOklab, oklabToOkhsv,
      okhslToOklab, oklabToOkhsl,
      okhwbToOklab, oklabToOkhwb,
      cusp,
      maxChroma: (L, h) => {
        const hr = (h / 180) * PI;
        const cp = cusp(Math.cos(hr), Math.sin(hr));
        return L > 0 && L < 1 ? gamutIntersection(Math.cos(hr), Math.sin(hr), L, 1, L, cp) : 0;
      },
    };
  }

  /**
   * The non-cube flavour (CMYK / LUT documents): S is the fraction of the document
   * gamut's chroma limit at that lightness and hue, so every S in 0..1 is a colour the
   * document can hold. `gamut.maxChroma(L, H)` supplies the limit.
   */
  function gamutRelative(gamut) {
    // A LUT/CMYK proof answers `maxChroma` with a cubic solve plus LUT interpolation, so
    // it cannot be called per pixel. Cache it on a (hue, lightness) grid and interpolate:
    // a disc plane touches one lightness row, an H x L plane fills the grid once.
    const NH = 360;
    const NL = 96;
    const cells = new Float32Array(NH * NL).fill(NaN);
    const cell = (xi, yi) => {
      const i = yi * NH + xi;
      let v = cells[i];
      if (Number.isNaN(v)) {
        v = gamut.maxChroma(yi / (NL - 1), (xi / NH) * 360) || 0;
        cells[i] = v;
      }
      return v;
    };
    const boundary = (L, h) => {
      if (!(L > 0 && L < 1)) return 0;
      const x = (mod360(h) / 360) * NH;
      const y = L * (NL - 1);
      const xi = Math.floor(x) % NH;
      const yi = Math.floor(y);
      const fx = x - Math.floor(x);
      const fy = y - yi;
      const x1 = (xi + 1) % NH;
      const y1 = yi + 1 >= NL ? NL - 1 : yi + 1;
      const a = cell(xi, yi);
      const b = cell(x1, yi);
      const c = cell(xi, y1);
      const d = cell(x1, y1);
      const top = a + (b - a) * fx;
      const bot = c + (d - c) * fx;
      const out = top + (bot - top) * fy;
      return out > 0 ? out : 0;
    };
    const svToOklab = (h, s, L) => labOf(L, clamp01(s) * boundary(L, h), h);

    function okhsvToOklab(h, s, v) {
      return svToOklab(h, s, clamp01(v));
    }
    function oklabToOkhsv(L0, a, b) {
      const L = clamp01(L0);
      const h = mod360((Math.atan2(b, a) * 180) / PI);
      const C = Math.hypot(a, b);
      const lim = boundary(L, h);
      return { h, s: lim > 1e-9 ? clamp01(C / lim) : 0, v: L };
    }
    function okhslToOklab(h, s, l) {
      return svToOklab(h, s, toeInv(clamp01(l)));
    }
    function oklabToOkhsl(L0, a, b) {
      const L = clamp01(L0);
      const h = mod360((Math.atan2(b, a) * 180) / PI);
      const C = Math.hypot(a, b);
      const lim = boundary(L, h);
      return { h, s: lim > 1e-9 ? clamp01(C / lim) : 0, l: toe(L) };
    }
    function okhwbToOklab(h, w, b) {
      const v = 1 - clamp01(b);
      const s = v > 1e-9 ? clamp01(1 - clamp01(w) / v) : 0;
      return okhsvToOklab(h, s, v);
    }
    function oklabToOkhwb(L0, a, b) {
      const r = oklabToOkhsv(L0, a, b);
      return { h: r.h, w: r.v * (1 - r.s), b: 1 - r.v };
    }

    return {
      kind: 'gamut',
      okhsvToOklab, oklabToOkhsv,
      okhslToOklab, oklabToOkhsl,
      okhwbToOklab, oklabToOkhwb,
      maxChroma: boundary,
    };
  }

  return { create, gamutRelative, toe, toeInv };
});

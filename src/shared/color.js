/*
 * Color math shared by the main process (HSV decoding of CSP's uint32 payloads)
 * and the renderer (OKLCH picker). Loads as CommonJS in Node and as a global
 * `Color` in the browser.
 *
 * OKLab/OKLCH conversion follows Bjorn Ottosson's reference implementation.
 * sRGB transfer functions follow IEC 61966-2-1.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Color = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_U32 = 4294967295;

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp01 = (x) => clamp(x, 0, 1);
  const mod360 = (h) => ((h % 360) + 360) % 360;

  // --- sRGB transfer -------------------------------------------------------

  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  // --- OKLab / OKLCH -------------------------------------------------------

  function linearRgbToOklab(r, g, b) {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);
    return {
      L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
      a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
      b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
    };
  }

  function oklabToLinearRgb(L, a, bb) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
    const s_ = L - 0.0894841775 * a - 1.291485548 * bb;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    return {
      r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    };
  }

  /** sRGB floats (0..1, gamma encoded) -> { L, C, H } (H in degrees). */
  function rgbToOklch(r, g, b) {
    return linearRgbToOklch(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  }

  /** Linear-sRGB floats -> { L, C, H } (H in degrees). */
  function linearRgbToOklch(r, g, b) {
    const lab = linearRgbToOklab(r, g, b);
    const C = Math.hypot(lab.a, lab.b);
    const H = mod360((Math.atan2(lab.b, lab.a) * 180) / Math.PI);
    return { L: lab.L, C, H };
  }

  /** OKLCH -> linear-sRGB floats (may fall outside [0,1] when out of gamut). */
  function oklchToLinearRgb(L, C, H) {
    const hr = (H * Math.PI) / 180;
    return oklabToLinearRgb(L, C * Math.cos(hr), C * Math.sin(hr));
  }

  /**
   * OKLCH -> sRGB. Channels are gamma-encoded floats and may fall outside
   * [0,1] when the color is out of the sRGB gamut; use `inGamut()` to test.
   */
  function oklchToRgb(L, C, H) {
    const hr = (H * Math.PI) / 180;
    const a = C * Math.cos(hr);
    const bb = C * Math.sin(hr);
    const lin = oklabToLinearRgb(L, a, bb);
    return {
      r: linearToSrgb(lin.r),
      g: linearToSrgb(lin.g),
      b: linearToSrgb(lin.b),
    };
  }

  /**
   * OKLCH -> OKLab (rectangular). This is the canonical representation: it has no
   * hue singularity and is the parent the polar view is derived from. It is
   * exactly the `a = C·cos H, b = C·sin H` step the render path already does.
   */
  function oklchToOklab(L, C, H) {
    const hr = (H * Math.PI) / 180;
    return { L, a: C * Math.cos(hr), b: C * Math.sin(hr) };
  }

  /** OKLab -> OKLCH (the derived polar view). Hue is 0 at C = 0; callers keep their own anchor. */
  function oklabToOklch(L, a, b) {
    return { L, C: Math.hypot(a, b), H: mod360((Math.atan2(b, a) * 180) / Math.PI) };
  }

  /** OKLab -> sRGB. Gamma-encoded floats, may fall outside [0,1] when out of gamut. */
  function oklabToRgb(L, a, b) {
    const lin = oklabToLinearRgb(L, a, b);
    return {
      r: linearToSrgb(lin.r),
      g: linearToSrgb(lin.g),
      b: linearToSrgb(lin.b),
    };
  }

  // Tolerance is in gamma-encoded sRGB units. It must stay very small: near
  // black, a linear channel error of ~1e-6 maps to ~1e-5 in sRGB, so a loose
  // epsilon would call a visibly out-of-gamut chroma "in gamut" and leave a
  // spurious spike at the left edge of the lightness plot.
  // Tolerance is relative to the colour's own magnitude. The OKLab<->sRGB
  // round trip carries ~1e-6 relative error near the gamut corners, while the
  // absolute channels near black are themselves only ~1e-6 — an absolute
  // epsilon would either reject real primaries or accept a spurious chroma at
  // very low lightness (a visible spike in the lightness plot).
  const GAMUT_REL_TOL = 1e-5;
  /** Is an OKLCH color displayable in sRGB? */
  function inGamut(L, C, H) {
    // The gamut collapses to a point at both ends of the lightness axis; without this
    // guard `chromaIntervals` reports no interval there while a hair of chroma passed.
    if (L <= 0 || L >= 1) return C <= 0;
    const { r, g, b } = oklchToRgb(L, C, H);
    const scale = Math.max(Math.abs(r), Math.abs(g), Math.abs(b), 1e-6);
    const eps = GAMUT_REL_TOL * scale;
    return (
      r >= -eps && r <= 1 + eps &&
      g >= -eps && g <= 1 + eps &&
      b >= -eps && b <= 1 + eps
    );
  }

  // --- gamut boundary ------------------------------------------------------
  //
  // At a fixed lightness and hue every linear-sRGB channel is a *cubic* in the
  // chroma C, because the OKLab -> linear-RGB step cubes l_, m_ and s_, which
  // are affine in C. So the in-gamut set along a hue ray is a union of intervals
  // whose ends are the C where a channel reaches 0 or 1. That union is *not*
  // single-valued near the primary corners: at blue's hue it is the body
  // [0, 0.2656] plus a thin fin out to the primary at 0.3132. A single binary
  // search from zero stops at the body and draws the primary as unreachable.

  /**
   * Real roots of `c0 + c1*x + c2*x^2 + c3*x^3` (Cardano).
   * @returns {number[]} unsorted real roots
   */
  function realRoots(c0, c1, c2, c3) {
    const out = [];
    const add = (x) => { if (Number.isFinite(x)) out.push(x); };
    if (Math.abs(c3) < 1e-14) {
      if (Math.abs(c2) < 1e-14) {
        if (Math.abs(c1) > 1e-14) add(-c0 / c1);
        return out;
      }
      const disc = c1 * c1 - 4 * c2 * c0;
      if (disc < 0) return out;
      const s = Math.sqrt(disc);
      add((-c1 + s) / (2 * c2));
      add((-c1 - s) / (2 * c2));
      return out;
    }
    const a = c2 / c3;
    const b = c1 / c3;
    const c = c0 / c3;
    const p = b - (a * a) / 3;
    const q = (2 * a * a * a) / 27 - (a * b) / 3 + c;
    const shift = -a / 3;
    const half = q / 2;
    const disc = half * half + (p * p * p) / 27;
    if (disc > 1e-14) {
      const s = Math.sqrt(disc);
      add(Math.cbrt(-half + s) + Math.cbrt(-half - s) + shift);
    } else if (disc > -1e-14) {
      const u = Math.cbrt(-half);
      add(2 * u + shift);
      add(-u + shift);
    } else {
      const r = Math.sqrt(-p / 3);
      const arg = clamp(((3 * q) / (2 * p)) * Math.sqrt(-3 / p), -1, 1);
      const theta = Math.acos(arg) / 3;
      for (let k = 0; k < 3; k++) add(2 * r * Math.cos(theta - (2 * Math.PI * k) / 3) + shift);
    }
    return out;
  }

  /**
   * The three linear-sRGB channels as cubics in chroma, at a fixed lightness and
   * hue: `channel(C) = c0 + c1*C + c2*C^2 + c3*C^3`.
   * @returns {number[4][]} one coefficient array per channel
   */
  function linearRgbChromaCubic(L, H) {
    const hr = (H * Math.PI) / 180;
    const ch = Math.cos(hr);
    const sh = Math.sin(hr);
    const cl = 0.3963377774 * ch + 0.2158037573 * sh;
    const cm = -0.1055613458 * ch - 0.0638541728 * sh;
    const cs = -0.0894841775 * ch - 1.291485548 * sh;
    const cube = (k) => [L * L * L, 3 * L * L * k, 3 * L * k * k, k * k * k];
    const l = cube(cl);
    const m = cube(cm);
    const s = cube(cs);
    const mix = (lr, mg, sb) => [0, 1, 2, 3].map((i) => lr * l[i] + mg * m[i] + sb * s[i]);
    return [
      mix(4.0767416621, -3.3077115913, 0.2309699292),
      mix(-1.2684380046, 2.6097574011, -0.3413193965),
      mix(-0.0041960863, -0.7034186147, 1.707614701),
    ];
  }

  /**
   * In-gamut chroma intervals in [0, upper] for a set of channel cubics. The
   * gamut predicate can only change where a channel reaches 0 or 1, so those
   * roots are the cuts to test between; `isIn` tests a single chroma.
   * @returns {Array<[number, number]>} sorted, non-overlapping intervals
   */
  function chromaIntervalsFromCubics(cubics, upper, isIn) {
    const cuts = [0, upper];
    for (const co of cubics) {
      for (const r of realRoots(co[0], co[1], co[2], co[3])) if (r > 0 && r < upper) cuts.push(r);
      for (const r of realRoots(co[0] - 1, co[1], co[2], co[3])) if (r > 0 && r < upper) cuts.push(r);
    }
    cuts.sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      if (b - a < 1e-12) continue;
      if (isIn((a + b) / 2)) out.push([a, b]);
    }
    return out;
  }

  /** In-gamut chroma intervals in sRGB at this lightness and hue. */
  function chromaIntervals(L, H, upper = 0.5) {
    if (L <= 0 || L >= 1) return [];
    return chromaIntervalsFromCubics(linearRgbChromaCubic(L, H), upper, (c) => inGamut(L, c, H));
  }

  /**
   * Largest in-gamut chroma for a lightness and hue. This is the gamut
   * silhouette the picker draws; it takes the outermost interval, so a primary
   * corner is reachable.
   */
  function maxChroma(L, H, upper = 0.5) {
    const l = clamp01(L);
    if (l <= 0 || l >= 1) return 0;
    const iv = chromaIntervals(l, H, upper);
    return iv.length ? iv[iv.length - 1][1] : 0;
  }

  /**
   * Largest in-gamut chroma `<= C`: what an out-of-gamut value snaps to. Never
   * raises C — the corner fin sits *above* the body, so it must not pull a
   * colour up onto it.
   */
  function reduceChroma(L, C, H, upper = 0.5) {
    const l = clamp01(L);
    if (l <= 0 || l >= 1 || C <= 0) return 0;
    if (inGamut(l, C, H)) return C;
    const iv = chromaIntervals(l, H, Math.max(upper, C));
    let best = 0;
    for (const [, b] of iv) if (b <= C && b > best) best = b;
    return best;
  }

  /** OKLCH clamped/hue-fitted into sRGB (chroma reduced until displayable). */
  function gamutMap(L, C, H) {
    const l = clamp01(L);
    if (C <= 0) return { L: l, C: 0, H };
    return { L: l, C: reduceChroma(l, C, H), H };
  }

  /**
   * What to *draw* for a requested appearance in an sRGB window: the same
   * lightness and hue, chroma pulled inside sRGB only when the screen cannot
   * show it. Display only — the pick and the recorded value keep the true
   * chroma (docs/COLOR.md).
   */
  function fitToSrgb(L, C, H) {
    if (inGamut(L, C, H)) return oklchToRgb(L, C, H);
    return oklchToRgb(L, reduceChroma(L, C, H), H);
  }

  // --- CIELAB (D65) --------------------------------------------------------
  //
  // CIELAB is a view over the same appearance (docs/COLOR.md): OKLab <-> Lab
  // goes through linear sRGB and XYZ. D65 keeps the hub's white point, so no
  // chromatic adaptation is involved; the ICC/PCS boundary adapts to D50.

  const M_SRGB_TO_XYZ = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
  ];
  const M_XYZ_TO_SRGB = [
    [3.2404542, -1.5371385, -0.4985314],
    [-0.9692660, 1.8760108, 0.0415560],
    [0.0556434, -0.2040259, 1.0572252],
  ];
  const D65_X = 0.95047, D65_Y = 1.0, D65_Z = 1.08883;
  const LAB_E = 216 / 24389, LAB_K = 24389 / 27;

  const labF = (t) => (t > LAB_E ? Math.cbrt(t) : (LAB_K * t + 16) / 116);
  const labFInv = (t) => {
    const t3 = t * t * t;
    return t3 > LAB_E ? t3 : (116 * t - 16) / LAB_K;
  };

  function linearRgbToXyz(r, g, b) {
    return {
      X: M_SRGB_TO_XYZ[0][0] * r + M_SRGB_TO_XYZ[0][1] * g + M_SRGB_TO_XYZ[0][2] * b,
      Y: M_SRGB_TO_XYZ[1][0] * r + M_SRGB_TO_XYZ[1][1] * g + M_SRGB_TO_XYZ[1][2] * b,
      Z: M_SRGB_TO_XYZ[2][0] * r + M_SRGB_TO_XYZ[2][1] * g + M_SRGB_TO_XYZ[2][2] * b,
    };
  }
  function xyzToLinearRgb(X, Y, Z) {
    return {
      r: M_XYZ_TO_SRGB[0][0] * X + M_XYZ_TO_SRGB[0][1] * Y + M_XYZ_TO_SRGB[0][2] * Z,
      g: M_XYZ_TO_SRGB[1][0] * X + M_XYZ_TO_SRGB[1][1] * Y + M_XYZ_TO_SRGB[1][2] * Z,
      b: M_XYZ_TO_SRGB[2][0] * X + M_XYZ_TO_SRGB[2][1] * Y + M_XYZ_TO_SRGB[2][2] * Z,
    };
  }
  function xyzToLab(X, Y, Z) {
    const fx = labF(X / D65_X), fy = labF(Y / D65_Y), fz = labF(Z / D65_Z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }
  function labToXyz(L, a, b) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    return { X: D65_X * labFInv(fx), Y: D65_Y * labFInv(fy), Z: D65_Z * labFInv(fz) };
  }
  function oklabToLab(L, a, b) {
    const lin = oklabToLinearRgb(L, a, b);
    const xyz = linearRgbToXyz(lin.r, lin.g, lin.b);
    return xyzToLab(xyz.X, xyz.Y, xyz.Z);
  }
  function labToOklab(L, a, b) {
    const xyz = labToXyz(L, a, b);
    const lin = xyzToLinearRgb(xyz.X, xyz.Y, xyz.Z);
    return linearRgbToOklab(lin.r, lin.g, lin.b);
  }

  // --- Okhsv (sRGB-referenced picker space) --------------------------------
  //
  // Bjorn Ottosson's Okhsv (MIT; bottosson.github.io/posts/colorpicker). It is
  // defined against sRGB, exposed here through OKLab so it shares the hub. The
  // working profile may be wider than sRGB, so okhsv s/v are sRGB-relative.

  const TOE_K1 = 0.206, TOE_K2 = 0.03, TOE_K3 = (1 + TOE_K1) / (1 + TOE_K2);
  const PI = Math.PI;

  const toe = (x) => 0.5 * (TOE_K3 * x - TOE_K1 + Math.sqrt((TOE_K3 * x - TOE_K1) ** 2 + 4 * TOE_K2 * TOE_K3 * x));
  const toeInv = (x) => (x * x + TOE_K1 * x) / (TOE_K3 * (x + TOE_K2));

  function computeMaxSaturation(a, b) {
    let k0, k1, k2, k3, k4, wl, wm, ws;
    if (-1.88170328 * a - 0.80936493 * b > 1) {
      k0 = 1.19086277; k1 = 1.76576728; k2 = 0.59662641; k3 = 0.75515197; k4 = 0.56771245;
      wl = 4.0767416621; wm = -3.3077115913; ws = 0.2309699292;
    } else if (1.81444104 * a - 1.19445276 * b > 1) {
      k0 = 0.73956515; k1 = -0.45954404; k2 = 0.08285427; k3 = 0.12541070; k4 = 0.14503204;
      wl = -1.2684380046; wm = 2.6097574011; ws = -0.3413193965;
    } else {
      k0 = 1.35733652; k1 = -0.00915799; k2 = -1.15130210; k3 = -0.50559606; k4 = 0.00692167;
      wl = -0.0041960863; wm = -0.7034186147; ws = 1.7076147010;
    }
    let S = k0 + k1 * a + k2 * b + k3 * a * a + k4 * a * b;
    const kl = 0.3963377774 * a + 0.2158037573 * b;
    const km = -0.1055613458 * a - 0.0638541728 * b;
    const ks = -0.0894841775 * a - 1.2914855480 * b;
    const l_ = 1 + S * kl, m_ = 1 + S * km, s_ = 1 + S * ks;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    const ldS = 3 * kl * l_ * l_, mdS = 3 * km * m_ * m_, sdS = 3 * ks * s_ * s_;
    const ldS2 = 6 * kl * kl * l_, mdS2 = 6 * km * km * m_, sdS2 = 6 * ks * ks * s_;
    const f = wl * l + wm * m + ws * s;
    const f1 = wl * ldS + wm * mdS + ws * sdS;
    const f2 = wl * ldS2 + wm * mdS2 + ws * sdS2;
    return S - (f * f1) / (f1 * f1 - 0.5 * f * f2);
  }

  /** The (L, C) of the most saturated sRGB colour at a hue direction. */
  function findCusp(a, b) {
    const S = computeMaxSaturation(a, b);
    const rgb = oklabToLinearRgb(1, S * a, S * b);
    const L = Math.cbrt(1 / Math.max(rgb.r, rgb.g, rgb.b));
    return { L, C: L * S };
  }

  /** Okhsv (h in degrees, s,v 0..1) -> OKLab. */
  function okhsvToOklab(h, s, v) {
    const hr = (h / 360) * 2 * PI;
    const a_ = Math.cos(hr), b_ = Math.sin(hr);
    const cusp = findCusp(a_, b_);
    const S_max = cusp.C / cusp.L, T_max = cusp.C / (1 - cusp.L);
    const S_0 = 0.5;
    const k = 1 - S_0 / S_max;
    const denom = S_0 + T_max - T_max * k * s;
    const L_v = 1 - (s * S_0) / denom;
    const C_v = (s * T_max * S_0) / denom;
    let L = v * L_v, C = v * C_v;
    const L_vt = toeInv(L_v);
    const C_vt = L_v ? (C_v * L_vt) / L_v : 0;
    const L_new = toeInv(L);
    C = L ? (C * L_new) / L : 0;
    L = L_new;
    const scale = oklabToLinearRgb(L_vt, a_ * C_vt, b_ * C_vt);
    const scaleL = Math.cbrt(1 / Math.max(scale.r, scale.g, scale.b, 0, 1e-12));
    L *= scaleL; C *= scaleL;
    const lin = oklabToLinearRgb(L, C * a_, C * b_);
    return linearRgbToOklab(lin.r, lin.g, lin.b);
  }

  /** OKLab -> Okhsv { h (0..360), s, v }. */
  function oklabToOkhsv(L0, a, b) {
    const C0 = Math.hypot(a, b);
    const a_ = C0 > 1e-12 ? a / C0 : 0;
    const b_ = C0 > 1e-12 ? b / C0 : 0;
    const h = mod360((0.5 + (0.5 * Math.atan2(-b, -a)) / PI) * 360);
    // Achromatic: no hue direction, s = 0 and v is the lightness (toe).
    if (C0 <= 1e-9) return { h, s: 0, v: toe(clamp01(L0)) };
    const cusp = findCusp(a_, b_);
    const S_max = cusp.C / cusp.L, T_max = cusp.C / (1 - cusp.L);
    const S_0 = 0.5;
    const k = 1 - S_0 / S_max;
    const t = T_max / (C0 + L0 * T_max);
    const L_v = t * L0, C_v = t * C0;
    const L_vt = toeInv(L_v);
    const C_vt = L_v ? (C_v * L_vt) / L_v : 0;
    const scale = oklabToLinearRgb(L_vt, a_ * C_vt, b_ * C_vt);
    const scaleL = Math.cbrt(1 / Math.max(scale.r, scale.g, scale.b, 0, 1e-12));
    let L = L0 / scaleL, C = C0 / scaleL;
    C = L ? (C * toe(L)) / L : 0;
    L = toe(L);
    const v = L_v ? L / L_v : 0;
    const s = ((S_0 + T_max) * C_v) / (T_max * S_0 + T_max * k * C_v);
    return { h, s, v };
  }

  // --- Okhsl / Okhwb (perceptual HSL, sRGB-referenced) ---------------------
  //
  // Bjorn Ottosson's Okhsl and Okhwb (MIT; bottosson.github.io/posts/colorpicker)
  // — the HSL- and HWB-shaped siblings of Okhsv, built on the same cusp/toe
  // machinery above. Both are defined against sRGB, so like Okhsv they are only
  // meaningful inside it. Okhsl's L is the *toe* of Oklab's L (Ottosson's
  // definition), not Oklab L itself.

  /** The cusp's (S, T) = (C/L, C/(1-L)) — the triangle the gamut fills. */
  function getStMax(cusp) {
    return [cusp.C / cusp.L, cusp.C / (1 - cusp.L)];
  }

  /** The mid-gamut (S, T) Ottosson fits C_mid against. */
  function getStMid(a_, b_) {
    const S = 0.11516993 + 1 / (
      7.4477897 + 4.1590124 * b_ +
      a_ * (-2.19557347 + 1.75198401 * b_ +
        a_ * (-2.13704948 - 10.02301043 * b_ +
          a_ * (-4.24894561 + 5.38770819 * b_ + 4.69891013 * a_))));
    const T = 0.11239642 + 1 / (
      1.6132032 - 0.68124379 * b_ +
      a_ * (0.40370612 + 0.90148123 * b_ +
        a_ * (-0.27087943 + 0.6122399 * b_ +
          a_ * (0.00299215 - 0.45399568 * b_ - 0.14661872 * a_))));
    return [S, T];
  }

  /**
   * Where the segment (L0,C0) -> (L1,C1) leaves the sRGB gamut: the cusp triangle
   * first, then one Halley step against the curved top. `a`,`b` are the unit hue
   * direction; the result is the parameter t along the segment.
   */
  function findGamutIntersection(a, b, L1, C1, L0, cusp) {
    const cp = cusp || findCusp(a, b);
    const kl = 0.3963377774 * a + 0.2158037573 * b;
    const km = -0.1055613458 * a - 0.0638541728 * b;
    const ks = -0.0894841775 * a - 1.2914855480 * b;
    let t;
    if ((L1 - L0) * cp.C - (cp.L - L0) * C1 <= 0) {
      t = (cp.C * L0) / (C1 * cp.L + cp.C * (L0 - L1));
    } else {
      t = (cp.C * (L0 - 1)) / (C1 * (cp.L - 1) + cp.C * (L0 - L1));
      const dL = L1 - L0, dC = C1;
      const ldt = dL + dC * kl, mdt = dL + dC * km, sdt = dL + dC * ks;
      const L = L0 * (1 - t) + t * L1, C = t * C1;
      const l_ = L + C * kl, m_ = L + C * km, s_ = L + C * ks;
      const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
      const l3 = 3 * ldt * l_ * l_, m3 = 3 * mdt * m_ * m_, s3 = 3 * sdt * s_ * s_;
      const l6 = 6 * ldt * ldt * l_, m6 = 6 * mdt * mdt * m_, s6 = 6 * sdt * sdt * s_;
      const channel = (w0, w1, w2) => {
        const f = w0 * l + w1 * m + w2 * s - 1;
        const f1 = w0 * l3 + w1 * m3 + w2 * s3;
        const f2 = w0 * l6 + w1 * m6 + w2 * s6;
        const u = f1 / (f1 * f1 - 0.5 * f * f2);
        return u >= 0 ? -f * u : 1e6;
      };
      t += Math.min(
        channel(4.0767416621, -3.3077115913, 0.2309699292),
        channel(-1.2684380046, 2.6097574011, -0.3413193965),
        channel(-0.0041960863, -0.7034186147, 1.7076147010),
      );
    }
    return t;
  }

  /** Okhsl's C_0 / C_mid / C_max at an (un-toed) lightness and hue direction. */
  function getCs(L, a_, b_) {
    if (!(L > 0 && L < 1)) return { C0: 0, Cmid: 0, Cmax: 0 };
    const cusp = findCusp(a_, b_);
    const Cmax = findGamutIntersection(a_, b_, L, 1, L, cusp);
    const [Smax, Tmax] = getStMax(cusp);
    const [Smid, Tmid] = getStMid(a_, b_);
    const k = Cmax / Math.min(L * Smax, (1 - L) * Tmax);
    const Ca = L * Smid, Cb = (1 - L) * Tmid;
    const Cmid = 0.9 * k * Math.sqrt(Math.sqrt(1 / (1 / Ca ** 4 + 1 / Cb ** 4)));
    const C0 = Math.sqrt(1 / (1 / ((L * 0.4) ** 2) + 1 / (((1 - L) * 0.8) ** 2)));
    return { C0, Cmid, Cmax };
  }

  /** Okhsl (h degrees, s 0..1, l 0..1) -> OKLab. */
  function okhslToOklab(h, s, l) {
    const L = toeInv(clamp01(l));
    if (!s || L <= 0 || L >= 1) return { L, a: 0, b: 0 };
    const hr = (h / 180) * PI;
    const a_ = Math.cos(hr), b_ = Math.sin(hr);
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

  /** OKLab -> Okhsl { h (0..360), s, l }. */
  function oklabToOkhsl(L0, a, b) {
    const l = toe(clamp01(L0));
    const C0 = Math.hypot(a, b);
    const h = mod360((Math.atan2(b, a) * 180) / PI);
    if (C0 <= 1e-12) return { h, s: 0, l };
    const a_ = a / C0, b_ = b / C0;
    const { C0: c0, Cmid, Cmax } = getCs(L0, a_, b_);
    let s;
    if (C0 < Cmid) {
      const k1 = 0.8 * c0;
      const k2 = 1 - k1 / Cmid;
      const t = (C0 - 0) / (k1 + k2 * (C0 - 0));
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

  /** Okhwb (h degrees, w 0..1, b 0..1) -> OKLab. Derived from Okhsv: w = v(1-s). */
  function okhwbToOklab(h, w, b) {
    const v = 1 - clamp01(b);
    const s = v > 1e-9 ? clamp01(1 - clamp01(w) / v) : 0;
    return okhsvToOklab(h, s, v);
  }

  /** OKLab -> Okhwb { h (0..360), w, b }. */
  function oklabToOkhwb(L0, a, b) {
    const { h, s, v } = oklabToOkhsv(L0, a, b);
    return { h, w: v * (1 - s), b: 1 - v };
  }

  // --- HSV / RGB -----------------------------------------------------------

  /** HSV -> RGB. h degrees, s/v 0..1. Returns gamma sRGB 0..1. */
  function hsvToRgb(h, s, v) {
    const hh = mod360(h) / 60;
    const c = v * s;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (hh < 1) { r = c; g = x; }
    else if (hh < 2) { r = x; g = c; }
    else if (hh < 3) { g = c; b = x; }
    else if (hh < 4) { g = x; b = c; }
    else if (hh < 5) { r = x; b = c; }
    else { r = c; b = x; }
    return { r: r + m, g: g + m, b: b + m };
  }

  /** RGB -> HSV. Returns { h: 0..360, s: 0..1, v: 0..1 }. */
  function rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: mod360(h), s: max === 0 ? 0 : d / max, v: max };
  }

  /** HSL -> RGB. h degrees, s/l 0..1. Returns gamma sRGB 0..1. */
  function hslToRgb(h, s, l) {
    const hh = mod360(h) / 60;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (hh < 1) { r = c; g = x; }
    else if (hh < 2) { r = x; g = c; }
    else if (hh < 3) { g = c; b = x; }
    else if (hh < 4) { g = x; b = c; }
    else if (hh < 5) { r = x; b = c; }
    else { r = c; b = x; }
    return { r: r + m, g: g + m, b: b + m };
  }

  /** RGB -> HSL. Returns { h: 0..360, s: 0..1, l: 0..1 }. */
  function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;
    let h = 0;
    if (d > 1e-6) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    const denominator = 1 - Math.abs(2 * l - 1);
    // At l = 0 or 1 the formula is singular, and a round-tripped white arrives with a
    // ~1e-7 channel spread: treat that as achromatic instead of reporting s == 1.
    const s = d <= 1e-6 || denominator <= 1e-9 ? 0 : Math.min(1, d / denominator);
    return { h: mod360(h), s, l };
  }

  /** sRGB (gamma 0..1) -> OKLab. */
  function rgbToOklab(r, g, b) {
    return linearRgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  }

  // --- hex -----------------------------------------------------------------

  const to255 = (x) => Math.round(clamp01(x) * 255);
  const channel255 = (x) => clamp(Math.round(Number(x) || 0), 0, 255).toString(16).padStart(2, '0');

  /** Hex from three 0..255 channels (clamped). */
  function rgbToHex(r, g, b) {
    if (typeof r === 'object' && r !== null) ({ r, g, b } = r);
    return `#${channel255(r)}${channel255(g)}${channel255(b)}`.toUpperCase();
  }

  /** Hex from three 0..1 channels (clamped). */
  function rgb01ToHex(r, g, b) {
    if (typeof r === 'object' && r !== null) ({ r, g, b } = r);
    return `#${channel255(to255(r))}${channel255(to255(g))}${channel255(to255(b))}`.toUpperCase();
  }

  function hexToRgb(hex) {
    let s = String(hex).trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }

  // --- CSP uint32 channel helpers -----------------------------------------

  const u32ToUnit = (v) => clamp(v, 0, MAX_U32) / MAX_U32;
  const u32ToHue = (v) => u32ToUnit(v) * 360;

  return {
    clamp,
    clamp01,
    mod360,
    srgbToLinear,
    linearToSrgb,
    rgbToOklch,
    linearRgbToOklch,
    oklchToLinearRgb,
    linearRgbToOklab,
    oklabToLinearRgb,
    oklchToRgb,
    oklchToOklab,
    oklabToOklch,
    oklabToRgb,
    inGamut,
    gamutMap,
    fitToSrgb,
    linearRgbToXyz,
    xyzToLinearRgb,
    xyzToLab,
    labToXyz,
    oklabToLab,
    labToOklab,
    okhsvToOklab,
    oklabToOkhsv,
    okhslToOklab,
    oklabToOkhsl,
    okhwbToOklab,
    oklabToOkhwb,
    maxChroma,
    reduceChroma,
    chromaIntervals,
    chromaIntervalsFromCubics,
    linearRgbChromaCubic,
    realRoots,
    oklabToRgb,
    hsvToRgb,
    rgbToHsv,
    hslToRgb,
    rgbToHsl,
    rgbToOklab,
    rgbToHex,
    rgb01ToHex,
    hexToRgb,
    u32ToUnit,
    u32ToHue,
    MAX_U32,
  };
});

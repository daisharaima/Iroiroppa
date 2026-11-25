(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./color'), require('./color-models'));
  } else {
    root.IroRasterPlane = factory(root.Color, root.IroColorModels);
  }
})(typeof self !== 'undefined' ? self : this, function (Color, Models) {
  'use strict';

  const LUT_N = 4096;
  const LUT = (() => {
    const table = new Float32Array(LUT_N + 1);
    for (let i = 0; i <= LUT_N; i++) table[i] = Color.linearToSrgb(i / LUT_N);
    return table;
  })();

  const GAMUT_REL_TOL = 1e-6;

  function gamma(lin) {
    if (!(lin > 0.0031308)) return 12.92 * lin;
    if (lin >= 1) return 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
    return LUT[(lin * LUT_N + 0.5) | 0];
  }

  const affineCache = new Map();

  function affineToLab(model) {
    if (!model || typeof model.toLab !== 'function' || !Array.isArray(model.axes)) return null;
    if (model.axes.length !== 3) return null;
    const id = model.id || '';
    if (affineCache.has(id)) return affineCache.get(id);
    let result = null;
    try {
      const zero = model.toLab([0, 0, 0]);
      const ex = model.toLab([1, 0, 0]);
      const ey = model.toLab([0, 1, 0]);
      const ez = model.toLab([0, 0, 1]);
      const m = [
        [ex.L - zero.L, ey.L - zero.L, ez.L - zero.L],
        [ex.a - zero.a, ey.a - zero.a, ez.a - zero.a],
        [ex.b - zero.b, ey.b - zero.b, ez.b - zero.b],
      ];
      const base = [zero.L, zero.a, zero.b];
      const sample = (x, y, z) => [
        base[0] + m[0][0] * x + m[0][1] * y + m[0][2] * z,
        base[1] + m[1][0] * x + m[1][1] * y + m[1][2] * z,
        base[2] + m[2][0] * x + m[2][1] * y + m[2][2] * z,
      ];
      const probes = [[0.3, 0.7, 0.2], [0.9, 0.1, 0.4], [0.5, 0.25, 0.75]];
      result = { base, m };
      for (const p of probes) {
        const want = model.toLab(p);
        const got = sample(p[0], p[1], p[2]);
        if (Math.abs(want.L - got[0]) > 1e-9
          || Math.abs(want.a - got[1]) > 1e-9
          || Math.abs(want.b - got[2]) > 1e-9) {
          result = null;
          break;
        }
      }
    } catch {
      result = null;
    }
    affineCache.set(id, result);
    return result;
  }

  function renderPlane(spec) {
    const { model, plane, fixed, ranges, width, height, out = null, workingGamut = null, luma = null, fill = false, outAlpha = 255, fillAlpha = 255, lens = null } = spec;
    const data = out || new Uint8ClampedArray(width * height * 4);
    const [hi, vi] = Models.planesFor(model)[plane];
    const hr = ranges[hi];
    const vr = ranges[vi];
    const axes = fixed.slice();
    const affine = affineToLab(model);
    const lab = { L: 0, a: 0, b: 0 };
    const lightIdx = Models.lightAxis(model);
    const nativeLight = Models.usesNativeLight(model);
    const spanU = hr.max - hr.min;
    const spanV = vr.max - vr.min;
    const hDen = height > 1 ? height - 1 : 1;
    const wDen = width > 1 ? width - 1 : 1;

    for (let y = 0; y < height; y++) {
      axes[vi] = vr.min + (1 - y / hDen) * spanV;
      let i = y * width * 4;
      for (let x = 0; x < width; x++, i += 4) {
        axes[hi] = hr.min + (x / wDen) * spanU;
        if (luma) luma[y * width + x] = NaN;
        let L, a, b;
        if (affine) {
          const m = affine.m;
          const base = affine.base;
          L = base[0] + m[0][0] * axes[0] + m[0][1] * axes[1] + m[0][2] * axes[2];
          a = base[1] + m[1][0] * axes[0] + m[1][1] * axes[1] + m[1][2] * axes[2];
          b = base[2] + m[2][0] * axes[0] + m[2][1] * axes[1] + m[2][2] * axes[2];
        } else {
          const got = model.toLab(axes);
          L = got.L; a = got.a; b = got.b;
        }
        lab.L = L; lab.a = a; lab.b = b;

        if (workingGamut && !workingGamut(lab)) {
          if (fill) {
            const lch = Color.oklabToOklch(L, a, b);
            const f = Color.fitToSrgb(lch.L, lch.C, lch.H);
            data[i] = clamp255(f.r * 255);
            data[i + 1] = clamp255(f.g * 255);
            data[i + 2] = clamp255(f.b * 255);
            data[i + 3] = fillAlpha;
          }
          continue;
        }

        const lin = Color.oklabToLinearRgb(L, a, b);
        const r = gamma(lin.r);
        const g = gamma(lin.g);
        const bl = gamma(lin.b);

        if (lens && (!workingGamut || workingGamut(lab))) {
          const c = lens.applySrgb(r, g, bl, LENS_SCRATCH);
          data[i] = clamp255(c[0] * 255);
          data[i + 1] = clamp255(c[1] * 255);
          data[i + 2] = clamp255(c[2] * 255);
          data[i + 3] = 255;
          if (luma) luma[y * width + x] = nativeLight ? axes[lightIdx] : L;
          continue;
        }
        if (r < -GAMUT_REL_TOL || r > 1 + GAMUT_REL_TOL
          || g < -GAMUT_REL_TOL || g > 1 + GAMUT_REL_TOL
          || bl < -GAMUT_REL_TOL || bl > 1 + GAMUT_REL_TOL) {
          if (!workingGamut || !workingGamut(lab)) {
            if (!fill) { data[i + 3] = 0; continue; }
            paintFitted(data, i, L, a, b, fillAlpha);
            continue;
          }
          if (outAlpha >= 255) {
            data[i] = clamp255(r * 255);
            data[i + 1] = clamp255(g * 255);
            data[i + 2] = clamp255(bl * 255);
            data[i + 3] = 255;
          } else {
            paintFitted(data, i, L, a, b, outAlpha);
          }
          if (luma) luma[y * width + x] = nativeLight ? axes[lightIdx] : L;
          continue;
        }

        data[i] = r <= 0 ? 0 : r >= 1 ? 255 : (r * 255 + 0.5) | 0;
        data[i + 1] = g <= 0 ? 0 : g >= 1 ? 255 : (g * 255 + 0.5) | 0;
        data[i + 2] = bl <= 0 ? 0 : bl >= 1 ? 255 : (bl * 255 + 0.5) | 0;
        data[i + 3] = 255;
        if (luma) luma[y * width + x] = nativeLight ? axes[lightIdx] : L;
      }
    }
    return data;
  }

  const clamp255 = (x) => (x <= 0 ? 0 : x >= 255 ? 255 : (x + 0.5) | 0);

  const LENS_SCRATCH = [0, 0, 0];

  const FILLED_OUT_OF_GAMUT_ALPHA = 140;

  function paintFitted(data, i, L, a, b, alpha) {
    const lch = Color.oklabToOklch(L, a, b);
    const f = Color.fitToSrgb(lch.L, lch.C, lch.H);
    data[i] = clamp255(f.r * 255);
    data[i + 1] = clamp255(f.g * 255);
    data[i + 2] = clamp255(f.b * 255);
    data[i + 3] = alpha;
  }

  const SRGB_WINDOW_TOL = 1e-6;

  function pixelFromLab(lab, out, workingGamut = null, outAlpha = 255, fill = false, lens = null) {
    const lin = Color.oklabToLinearRgb(lab.L, lab.a, lab.b);
    const r = gamma(lin.r);
    const g = gamma(lin.g);
    const b = gamma(lin.b);
    if (lens) {
      if (workingGamut && !workingGamut(lab)) {
        if (fill) paintFitted(out, 0, lab.L, lab.a, lab.b, FILLED_OUT_OF_GAMUT_ALPHA);
        else out[3] = 0;
        return out;
      }
      const c = lens.applySrgb(r, g, b, LENS_SCRATCH);
      out[0] = clamp255(c[0] * 255);
      out[1] = clamp255(c[1] * 255);
      out[2] = clamp255(c[2] * 255);
      out[3] = 255;
      return out;
    }
    if (r < -SRGB_WINDOW_TOL || r > 1 + SRGB_WINDOW_TOL
      || g < -SRGB_WINDOW_TOL || g > 1 + SRGB_WINDOW_TOL
      || b < -SRGB_WINDOW_TOL || b > 1 + SRGB_WINDOW_TOL) {
      if (!workingGamut || !workingGamut(lab)) {
        if (fill) paintFitted(out, 0, lab.L, lab.a, lab.b, FILLED_OUT_OF_GAMUT_ALPHA);
        else out[3] = 0;
        return out;
      }
      if (outAlpha >= 255) {
        out[0] = clamp255(r * 255);
        out[1] = clamp255(g * 255);
        out[2] = clamp255(b * 255);
        out[3] = 255;
        return out;
      }
      const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
      const f = Color.fitToSrgb(lch.L, lch.C, lch.H);
      out[0] = clamp255(f.r * 255);
      out[1] = clamp255(f.g * 255);
      out[2] = clamp255(f.b * 255);
      out[3] = outAlpha;
      return out;
    }
    out[0] = r <= 0 ? 0 : r >= 1 ? 255 : (r * 255 + 0.5) | 0;
    out[1] = g <= 0 ? 0 : g >= 1 ? 255 : (g * 255 + 0.5) | 0;
    out[2] = b <= 0 ? 0 : b >= 1 ? 255 : (b * 255 + 0.5) | 0;
    out[3] = 255;
    return out;
  }

  return { renderPlane, pixelFromLab, affineToLab, gamma, GAMUT_REL_TOL };
});

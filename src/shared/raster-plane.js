/*
 * Plane rasteriser — the per-pixel colour of one slice, in one place.
 *
 * Every non-OKLCH model's map used to convert each pixel through the whole chain
 * (axes -> OKLab -> OKLCH -> gamut test -> sRGB) with several object allocations
 * per pixel. On a panel-sized plane (~160k device pixels) that is 150 ms for
 * CIELAB and ~350 ms for HelmGen, which is what made those pickers lag while a
 * drag rebuilt a map per frame (docs/PERF.md).
 *
 * This module keeps the same predicate and the same picture but does it once:
 *
 *   axes -> OKLab            (one call, or one dot product for an affine model)
 *   OKLab -> linear sRGB     (one matrix)
 *   linear -> sRGB           (a 4096-entry LUT)
 *   inside the sRGB cube?    (the display test, on the values we already have)
 *
 * HelmGen's GenSpace is a *linear* space over XYZ, so its axis-to-OKLab map is a
 * 3x3 matrix plus an offset; we validate that numerically once and then skip the
 * vendored bundle's per-pixel path (1.31 us -> ~0.05 us). Any model that fails the
 * validation keeps its own `toLab`.
 *
 * Loads as CommonJS in Node and as a global `IroRasterPlane` in the renderer.
 */
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

  // The magnitude-relative tolerance the rest of the app uses, applied in linear
  // light: a linear channel in [0, 1] is exactly a displayable one, and the LUT
  // below only quantises the value written, not the test.
  const GAMUT_REL_TOL = 1e-6;

  /** Linear light -> gamma sRGB, exact at the ends, LUT in between. */
  function gamma(lin) {
    // The linear toe (and anything negative) is exact and cheap: that is where a
    // linear-indexed LUT would be least accurate, because the curve is steepest.
    if (!(lin > 0.0031308)) return 12.92 * lin;
    if (lin >= 1) return 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
    return LUT[(lin * LUT_N + 0.5) | 0];
  }

  // --- affine models ---------------------------------------------------------

  const affineCache = new Map();

  /** Compose `toLab` as base + M·axes when the model is linear in its axes. */
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

  // --- the plane -------------------------------------------------------------

  /**
   * Rasterise one model plane into an RGBA buffer.
   *
   * @param {object} spec
   * @param {object} spec.model        a registered color model
   * @param {number} spec.plane        plane index (see Models.planesFor)
   * @param {number[]} spec.fixed      the three axes, with the fixed one filled in
   * @param {{min:number,max:number}[]} spec.ranges  per free axis, in axis order
   * @param {number} spec.width
   * @param {number} spec.height
   * @param {Uint8ClampedArray} [spec.out]  destination (length width*height*4)
   * @param {Float32Array} [spec.luma]  optional per-pixel lightness field, in the
   *        model's own light units (native axis for a `native` model — CIELAB L*,
   *        HelmGen L — else OKLab L); NaN where the pixel is transparent. The
   *        iso-lightness guides are extracted from this field (src/shared/contour.js).
   * @param {Function|null} [spec.workingGamut]  (lab) => bool when a wide profile is
   *        the working gamut; null means the working gamut is sRGB itself
   * @returns {Uint8ClampedArray}
   */
  function renderPlane(spec) {
    const { model, plane, fixed, ranges, width, height, out = null, workingGamut = null, luma = null, fill = false } = spec;
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
          // Out of the document gamut. Kept as a hole for perceptual models (the slice
          // shows only what it can pick) but painted dimmed when `fill` is set — a dense
          // model's map is a shape, not a silhouette with bites out of it.
          if (fill) {
            const lch = Color.oklabToOklch(L, a, b);
            const f = Color.fitToSrgb(lch.L, lch.C, lch.H);
            data[i] = clamp255(f.r * 255);
            data[i + 1] = clamp255(f.g * 255);
            data[i + 2] = clamp255(f.b * 255);
            data[i + 3] = OUT_ALPHA;
          }
          continue;
        }

        const lin = Color.oklabToLinearRgb(L, a, b);
        const r = gamma(lin.r);
        if (r < -GAMUT_REL_TOL || r > 1 + GAMUT_REL_TOL) {
          if (!fill) { data[i + 3] = 0; continue; }
          paintFitted(data, i, L, a, b, OUT_ALPHA);
          continue;
        }
        const g = gamma(lin.g);
        if (g < -GAMUT_REL_TOL || g > 1 + GAMUT_REL_TOL) {
          if (!fill) { data[i + 3] = 0; continue; }
          paintFitted(data, i, L, a, b, OUT_ALPHA);
          continue;
        }
        const bl = gamma(lin.b);
        if (bl < -GAMUT_REL_TOL || bl > 1 + GAMUT_REL_TOL) {
          if (!fill) { data[i + 3] = 0; continue; }
          paintFitted(data, i, L, a, b, OUT_ALPHA);
          continue;
        }

        if (workingGamut && (r < 0 || r > 1 || g < 0 || g > 1 || bl < 0 || bl > 1)) {
          // Inside the working gamut but past sRGB: draw the lightness-preserving
          // stand-in (docs/COLOR.md) rather than clipping.
          const lch = Color.oklabToOklch(L, a, b);
          const f = Color.fitToSrgb(lch.L, lch.C, lch.H);
          data[i] = clamp255(f.r * 255);
          data[i + 1] = clamp255(f.g * 255);
          data[i + 2] = clamp255(f.b * 255);
          data[i + 3] = 255;
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

  // Opacity of a filled out-of-gamut pixel: the panel background shows through, so it
  // reads as a dimmed colour on any theme and the map keeps its shape.
  const OUT_ALPHA = 140;

  /** Paint the sRGB stand-in of a colour at `alpha` (used by the fill mode). */
  function paintFitted(data, i, L, a, b, alpha) {
    const lch = Color.oklabToOklch(L, a, b);
    const f = Color.fitToSrgb(lch.L, lch.C, lch.H);
    data[i] = clamp255(f.r * 255);
    data[i + 1] = clamp255(f.g * 255);
    data[i + 2] = clamp255(f.b * 255);
    data[i + 3] = alpha;
  }

  // The magnitude-relative tolerance the gamut test uses, in gamma sRGB units.
  const WIN_TOL = 1e-6;

  /**
   * One OKLab pixel as gamma sRGB bytes, by the same chain as the plane raster.
   * Alpha is 0 when the colour is outside the working gamut; `workingGamut` is null
   * when the working gamut is sRGB itself (the common case, and the fast one).
   */
  function pixelFromLab(lab, out, workingGamut = null) {
    const lin = Color.oklabToLinearRgb(lab.L, lab.a, lab.b);
    const r = gamma(lin.r);
    const g = gamma(lin.g);
    const b = gamma(lin.b);
    if (r < -WIN_TOL || r > 1 + WIN_TOL
      || g < -WIN_TOL || g > 1 + WIN_TOL
      || b < -WIN_TOL || b > 1 + WIN_TOL) {
      if (!workingGamut || !workingGamut(lab)) { out[3] = 0; return out; }
      // Inside the working gamut but past sRGB: draw the stand-in, never clip.
      const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
      const f = Color.fitToSrgb(lch.L, lch.C, lch.H);
      out[0] = clamp255(f.r * 255);
      out[1] = clamp255(f.g * 255);
      out[2] = clamp255(f.b * 255);
      out[3] = 255;
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

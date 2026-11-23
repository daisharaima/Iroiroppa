
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./color'), require('./raster-plane'));
  } else {
    root.IroSlicePlane = factory(root.Color, root.IroRasterPlane);
  }
})(typeof self !== 'undefined' ? self : this, function (Color, Raster) {
  'use strict';

  const gamma = Raster.gamma;

  const GAMUT_REL_TOL = 1e-5;

  const R0 = 4.0767416621, R1 = -3.3077115913, R2 = 0.2309699292;
  const G0 = -1.2684380046, G1 = 2.6097574011, G2 = -0.3413193965;
  const B0 = -0.0041960863, B1 = -0.7034186147, B2 = 1.707614701;
  const K0 = [0.3963377774, 0.2158037573];
  const K1 = [-0.1055613458, -0.0638541728];
  const K2 = [-0.0894841775, -1.291485548];

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp01 = (x) => clamp(x, 0, 1);
  const b255 = (x) => (x <= 0 ? 0 : x >= 255 ? 255 : (x + 0.5) | 0);

  /** `l_ = L + C * A` for each channel, with A folded from the hue (degrees). */
  function coefficients(Hdeg) {
    const hr = (Hdeg * Math.PI) / 180;
    const ch = Math.cos(hr);
    const sh = Math.sin(hr);
    return [
      K0[0] * ch + K0[1] * sh,
      K1[0] * ch + K1[1] * sh,
      K2[0] * ch + K2[1] * sh,
    ];
  }

  /** Scratch pixel for the single-colour path, so a fin does not allocate. */
  const SCRATCH = new Uint8ClampedArray(4);

  /** Scratch for a lensed colour, so a band does not allocate per pixel. */
  const LENSED = [0, 0, 0];

  /**
   * Write one OKLCH pixel as gamma sRGB bytes.
   * `o0..o2` are the finished `C * A` offsets, so nothing is multiplied twice.
   * Returns false when the display cannot show the colour (the caller treats that as
   * a hole); the fitted stand-in is written when `fit` is set.
   */
  function encode(prep, data, i, L, o0, o1, o2, C, H, fit, luma, idx, lumaValue) {
    const l_ = L + o0, m_ = L + o1, s_ = L + o2;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    const r = gamma(R0 * l + R1 * m + R2 * s);
    const g = gamma(G0 * l + G1 * m + G2 * s);
    const b = gamma(B0 * l + B1 * m + B2 * s);

    const lens = prep && prep.lens;
    if (lens) {
      const c = lens.applySrgb(r, g, b, LENSED);
      data[i] = b255(c[0] * 255);
      data[i + 1] = b255(c[1] * 255);
      data[i + 2] = b255(c[2] * 255);
      data[i + 3] = 255;
      if (luma) luma[idx] = lumaValue;
      return true;
    }
    const scale = Math.max(Math.abs(r), Math.abs(g), Math.abs(b), 1e-6);
    const eps = GAMUT_REL_TOL * scale;
    const outside = r < -eps || r > 1 + eps || g < -eps || g > 1 + eps || b < -eps || b > 1 + eps;
    if (outside) {
      if (!fit) return false;

      const f = Color.fitToSrgb(L, C, H);
      data[i] = b255(f.r * 255);
      data[i + 1] = b255(f.g * 255);
      data[i + 2] = b255(f.b * 255);
    } else {
      data[i] = b255(r * 255);
      data[i + 1] = b255(g * 255);
      data[i + 2] = b255(b * 255);
    }
    data[i + 3] = 255;
    if (luma) luma[idx] = lumaValue;
    return true;
  }

  /**
   * Prepare one plane: the per-plane and per-column constants the old loop rebuilt at
   * every pixel (trigonometry, the axes ranges, the silhouette intervals).
   *
   * @param {object} spec
   * @param {'lc'|'hc'|'hue'} spec.kind  the plane's two free axes
   * @param {number} spec.width
   * @param {number} spec.height
   * @param {number[]} spec.fixed  the three axes, the fixed one filled in
   * @param {number} spec.cmax     the chroma axis bound
   * @param {Function} [spec.intervalsAt]  (u) => [[lo,hi],...] in-gamut chroma
   *        intervals of one column; `lc`/`hc` only
   * @param {Function} [spec.inDocument]  (L,C,H) => bool, the *document* gamut test when
   *        it differs from sRGB (a working-gamut proof); `hue` only
   */
  function prepare(spec) {
    const kind = spec.kind;
    const w = Math.max(1, spec.width | 0);
    const h = Math.max(1, spec.height | 0);
    const cmax = Number.isFinite(spec.cmax) ? spec.cmax : 0.4;
    const fixed = spec.fixed || [0, 0, 0];
    const wDen = Math.max(1, w - 1);
    const prep = {
      kind, w, h, cmax, fixed, wDen, hDen: Math.max(1, h - 1),
      intervalsAt: spec.intervalsAt || null,
      inDocument: spec.inDocument || null,
      cols: null,

      lens: spec.lens || null,

      flat: null,
      k0: null, k1: null, k2: null,
      light: null,
    };

    if (kind === 'lc') {

      prep.flat = coefficients(fixed[2] || 0);
      prep.light = new Float64Array(w);
      prep.cols = new Array(w);
      for (let x = 0; x < w; x += 1) {
        prep.light[x] = clamp01(x / wDen);
        prep.cols[x] = prep.intervalsAt(x / wDen);
      }
    } else if (kind === 'hc') {

      prep.k0 = new Float64Array(w);
      prep.k1 = new Float64Array(w);
      prep.k2 = new Float64Array(w);
      prep.cols = new Array(w);
      for (let x = 0; x < w; x += 1) {
        const A = coefficients((x / wDen) * 360);
        prep.k0[x] = A[0]; prep.k1[x] = A[1]; prep.k2[x] = A[2];
        prep.cols[x] = prep.intervalsAt(x / wDen);
      }
    } else if (kind === 'hue') {

      const C = fixed[1] || 0;
      prep.k0 = new Float64Array(w);
      prep.k1 = new Float64Array(w);
      prep.k2 = new Float64Array(w);
      for (let x = 0; x < w; x += 1) {
        const A = coefficients((x / wDen) * 360);
        prep.k0[x] = C * A[0]; prep.k1[x] = C * A[1]; prep.k2[x] = C * A[2];
      }
    } else {
      throw new Error(`unknown slice plane kind: ${kind}`);
    }
    return prep;
  }

  /**
   * Fill rows [y0, y1) of one plane.
   *
   * A pixel the silhouette excludes is left transparent (alpha 0): the caller keeps
   * the previous image on screen until this one lands, so a hole is a hole, never a
   * white flash.
   */
  function fillRows(prep, data, luma, y0, y1) {
    const { kind, w, cmax, fixed, wDen, hDen, cols } = prep;
    const from = Math.max(0, y0 | 0);
    const to = Math.min(prep.h, y1 | 0);

    if (kind === 'lc') {
      const [a0, a1, a2] = prep.flat;
      const light = prep.light;
      const hue = fixed[2];
      for (let y = from; y < to; y += 1) {
        const C = (1 - y / hDen) * cmax;

        const o0 = C * a0, o1 = C * a1, o2 = C * a2;
        let i = y * w * 4;
        for (let x = 0; x < w; x += 1, i += 4) {
          const ivs = cols[x];
          let inside = false;
          for (let k = 0; k < ivs.length; k += 1) {
            if (C >= ivs[k][0] && C <= ivs[k][1]) { inside = true; break; }
          }
          if (!inside) { data[i + 3] = 0; continue; }
          const L = light[x];
          encode(prep, data, i, L, o0, o1, o2, C, hue, true, luma, y * w + x, L);
        }
      }
      return;
    }

    if (kind === 'hc') {
      const L = fixed[0];
      const k0 = prep.k0, k1 = prep.k1, k2 = prep.k2;
      for (let y = from; y < to; y += 1) {
        const C = (1 - y / hDen) * cmax;
        let i = y * w * 4;
        for (let x = 0; x < w; x += 1, i += 4) {
          const ivs = cols[x];
          let inside = false;
          for (let k = 0; k < ivs.length; k += 1) {
            if (C >= ivs[k][0] && C <= ivs[k][1]) { inside = true; break; }
          }
          if (!inside) { data[i + 3] = 0; continue; }
          encode(prep, data, i, L, C * k0[x], C * k1[x], C * k2[x], C, (x / wDen) * 360, true, luma, y * w + x, L);
        }
      }
      return;
    }

    const C = fixed[1];
    const k0 = prep.k0, k1 = prep.k1, k2 = prep.k2;
    const inDocument = prep.inDocument;
    for (let y = from; y < to; y += 1) {
      const L = 1 - y / hDen;

      const edge = L <= 0 || L >= 1;
      let i = y * w * 4;
      for (let x = 0; x < w; x += 1, i += 4) {
        if (edge) { data[i + 3] = 0; continue; }
        const H = (x / wDen) * 360;
        if (inDocument) {

          if (inDocument(L, C, H)) {
            encode(prep, data, i, L, k0[x], k1[x], k2[x], C, H, true, luma, y * w + x, L);
          } else {
            data[i + 3] = 0;
          }
          continue;
        }

        encode(prep, data, i, L, k0[x], k1[x], k2[x], C, H, false, luma, y * w + x, L);
      }
    }
  }

  /**
   * A silhouette column whose in-gamut interval is narrower than one row still gets a
   * scanline: at a primary corner the gamut is the body *plus* a thin fin, and a
   * sub-row interval would otherwise be dropped and the corner drawn as unreachable.
   */
  function paintFins(prep, data, luma) {
    const { kind, w, h, cmax, fixed, wDen, hDen, cols } = prep;
    if (!cols) return;
    const minC = cmax / Math.max(1, h - 1);
    for (let x = 0; x < w; x += 1) {
      const ivs = cols[x];
      for (let k = 0; k < ivs.length; k += 1) {
        const iv = ivs[k];
        if (iv[1] - iv[0] >= minC) continue;
        const y = clamp(Math.round((1 - iv[1] / cmax) * hDen), 0, h - 1);
        const i = (y * w + x) * 4;
        const C = (1 - y / hDen) * cmax;
        if (kind === 'lc') {
          const L = clamp01(x / wDen);
          const A = prep.flat;
          encode(prep, SCRATCH, 0, L, C * A[0], C * A[1], C * A[2], C, fixed[2], true, null, 0, 0);
          data[i] = SCRATCH[0]; data[i + 1] = SCRATCH[1]; data[i + 2] = SCRATCH[2];
          if (luma) luma[y * w + x] = L;
        } else {
          encode(prep, data, i, fixed[0], C * prep.k0[x], C * prep.k1[x], C * prep.k2[x],
            C, (x / wDen) * 360, true, luma, y * w + x, fixed[0]);
        }
        data[i + 3] = 255;
      }
    }
  }

  return { prepare, fillRows, paintFins, coefficients };
});

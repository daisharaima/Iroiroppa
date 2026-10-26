/*
 * ICC proofing support: parse a matrix/TRC profile and build the T / T-inverse
 * transform between sRGB and the proof space.
 *
 * Three appearance models exist. Only `working` is reachable from the UI, and it
 * is the only one proven in real use; `colorimetric` and `display` are dev-only
 * (selectable only with `--shot --proof-model <model>`, or by editing
 * `settings.json` directly):
 *
 *   'working'       The records are already in the profile's (working) space.
 *                   appearance = proofToSrgb(record); recorded = srgbToProof().
 *   'colorimetric'  The records are treated as sRGB and shown unchanged
 *                   (identity); the profile is not applied at all.
 *   'display'       The records are sRGB and the profile encoding is shown
 *                   directly: appearance = srgbToProof(record) — the inverse of
 *                   `working`.
 *
 * Loads as CommonJS (Node) or as a global `Proof` (renderer).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./color.js'), require('./lut.js'));
  else root.Proof = factory(root.Color, root.IroLut);
})(typeof self !== 'undefined' ? self : this, function (Color, Lut) {
  'use strict';

  // --- 3x3 matrix helpers --------------------------------------------------

  const mulVec = (m, v) => [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];

  const mulMat = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));

  function inv3(m) {
    const [a, b, c] = m[0];
    const [d, e, f] = m[1];
    const [g, h, i] = m[2];
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!det) throw new Error('singular matrix');
    return [
      [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
      [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
    ];
  }

  // sRGB (D65) <-> XYZ, Bradford D65 <-> D50.
  const M_SRGB = [
    [0.4123908, 0.3575843, 0.1804808],
    [0.2126390, 0.7151687, 0.0721923],
    [0.0193308, 0.1191948, 0.9505322],
  ];
  const M_SRGB_INV = inv3(M_SRGB);
  const BRADFORD_D65_D50 = [
    [1.0478112, 0.0228866, -0.0501270],
    [0.0295424, 0.9904844, -0.0170491],
    [-0.0092345, 0.0150436, 0.7521316],
  ];
  const BRADFORD_D50_D65 = inv3(BRADFORD_D65_D50);

  const D50 = [0.9642, 1.0, 0.8249];
  const D65 = [0.950455, 1.0, 1.08905];

  // --- ICC parsing ---------------------------------------------------------

  function parseIcc(input) {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const u32 = (o) => buf.readUInt32BE(o);
    const s15 = (o) => buf.readInt32BE(o) / 65536;
    const sig = (o, n = 4) => buf.toString('latin1', o, o + n);

    if (sig(36) !== 'acsp') throw new Error('not an ICC profile');
    const profile = {
      // ICC versions are BCD: major.minor.bugfix
      version: `${buf[8]}.${(buf[9] >> 4) & 0xf}.${buf[9] & 0xf}`,
      deviceClass: sig(12),
      dataSpace: sig(16),
      pcs: sig(20),
      intent: u32(64),
      pcsIlluminant: [s15(68), s15(72), s15(76)],
      description: '',
    };

    const count = u32(128);
    const tags = {};
    for (let i = 0; i < count; i++) {
      const o = 132 + i * 12;
      tags[sig(o)] = { offset: u32(o + 4), size: u32(o + 8) };
    }
    profile.tags = Object.keys(tags);

    const xyz = (o) => [s15(o + 8), s15(o + 12), s15(o + 16)];
    if (tags.wtpt) profile.mediaWhite = xyz(tags.wtpt.offset);
    if (tags.rXYZ && tags.gXYZ && tags.bXYZ) {
      const r = xyz(tags.rXYZ.offset);
      const g = xyz(tags.gXYZ.offset);
      const b = xyz(tags.bXYZ.offset);
      profile.colorants = [
        [r[0], g[0], b[0]],
        [r[1], g[1], b[1]],
        [r[2], g[2], b[2]],
      ];
    }
    if (tags.chad) {
      const o = tags.chad.offset;
      const m = [];
      for (let i = 0; i < 9; i++) m.push(s15(o + 8 + i * 4));
      profile.chad = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
    }
    profile.trc = tags.rTRC ? parseTrc(buf, tags.rTRC.offset, sig) : { type: 'identity' };

    if (tags.desc) profile.description = parseText(buf, tags.desc.offset, sig, u32);
    return profile;
  }

  function parseTrc(buf, o, sig) {
    const type = sig(o);
    if (type === 'curv') {
      const n = buf.readUInt32BE(o + 8);
      if (n === 0) return { type: 'identity' };
      if (n === 1) return { type: 'gamma', gamma: buf.readUInt16BE(o + 12) / 256 };
      const values = new Float64Array(n);
      for (let i = 0; i < n; i++) values[i] = buf.readUInt16BE(o + 12 + i * 2) / 65535;
      return { type: 'table', values };
    }
    if (type === 'para') {
      const fn = buf.readUInt16BE(o + 8);
      const counts = [1, 3, 4, 5, 7];
      const nParams = counts[fn] ?? 0;
      const params = [];
      for (let i = 0; i < nParams; i++) params.push(buf.readInt32BE(o + 12 + i * 4) / 65536);
      return { type: 'para', fn, params };
    }
    return { type: 'identity' };
  }

  function parseText(buf, o, sig, u32) {
    const type = sig(o);
    if (type === 'desc') {
      const n = u32(o + 8);
      const raw = buf.toString('latin1', o + 12, o + 12 + Math.max(0, n));
      return raw.split('\0')[0]; // the ASCII string is NUL-terminated
    }
    if (type === 'mluc') {
      const len = u32(o + 20);
      const off = u32(o + 24);
      // UTF-16BE
      let s = '';
      for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode(buf.readUInt16BE(o + off + i));
      return s.split('\0')[0];
    }
    return '';
  }

  /**
   * Pick the best Adobe RGB (1998) profile filename from a directory listing.
   * Prefers the canonical `AdobeRGB1998.icc`, then any other "Adobe RGB" profile.
   * @param {string[]} names
   * @returns {string|null}
   */
  function pickAdobeRgbProfileName(names) {
    const icc = (Array.isArray(names) ? names : []).filter((n) => /\.(icc|icm)$/i.test(n));
    const canonical = icc.find((n) => /^adobe[-\s_]*rgb[-\s_]*\(?1998\)?\.ic[cm]$/i.test(n));
    if (canonical) return canonical;
    return icc.find((n) => /adobe[-\s_]*rgb/i.test(n)) || null;
  }

  // --- tone curve ----------------------------------------------------------

  function makeCurve(trc) {
    if (trc.type === 'identity') return { decode: (x) => x, encode: (y) => y };
    if (trc.type === 'gamma') {
      const g = trc.gamma;
      return {
        decode: (x) => (x <= 0 ? 0 : Math.pow(x, g)),
        encode: (y) => (y <= 0 ? 0 : y >= 1 ? 1 : Math.pow(y, 1 / g)),
      };
    }
    if (trc.type === 'para') {
      const [g, a, b, c, d, e, f] = trc.params;
      const p = (base) => Math.pow(base <= 0 ? 0 : base, g);
      const dec = (x) => {
        switch (trc.fn) {
          case 0: return p(x);
          case 1: return x >= -b / a ? p(a * x + b) : 0;
          case 2: return x >= -b / a ? p(a * x + b) + c : c;
          case 3: return x >= d ? p(a * x + b) : c * x;
          default: return x >= d ? p(a * x + b) + e : c * x + f;
        }
      };
      return { decode: dec, encode: invert(dec) };
    }
    // sampled table: device -> linear
    const v = trc.values;
    const n = v.length;
    const decode = (x) => {
      if (x <= 0) return v[0];
      if (x >= 1) return v[n - 1];
      const pos = x * (n - 1);
      const i = Math.floor(pos);
      const t = pos - i;
      return v[i] + (v[Math.min(i + 1, n - 1)] - v[i]) * t;
    };
    const encode = (y) => {
      if (y <= v[0]) return 0;
      if (y >= v[n - 1]) return 1;
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (v[mid] <= y) lo = mid;
        else hi = mid;
      }
      const t = (y - v[lo]) / (v[hi] - v[lo] || 1);
      return (lo + t) / (n - 1);
    };
    return { decode, encode };
  }

  function invert(fn) {
    return (y) => {
      if (y <= 0) return 0;
      if (y >= 1) return 1;
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (fn(mid) < y) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
  }

  // --- proof pipeline ------------------------------------------------------

  /**
   * A CMYK (LUT-based) proof, soft-proof only: it shows what the recorded sRGB
   * would look like printed through the profile, and leaves the recorded values
   * untouched. The two grids are baked in main
   * (`src/main/cmyk.js`) because the engine is a main-process dependency; the
   * interpolation is `src/shared/lut.js`.
   */
  function createLutProof(profile, model = 'colorimetric') {
    const { size, invSize, forward, inverse } = profile.lut;

    /** sRGB (gamma floats) -> CMYK (0..1). */
    const srgbToProof = (rgb) => Lut.interp3(forward, size, [rgb[0], rgb[1], rgb[2]]);
    /** CMYK (0..1) -> sRGB (gamma floats). */
    const proofToSrgb = (proof) => Lut.interp4(inverse, invSize, [proof[0], proof[1], proof[2], proof[3]]);
    /** The print appearance of an sRGB value: route it through the profile. */
    const softProof = (rgb) => proofToSrgb(srgbToProof(rgb));

    const oklchToSrgbFloats = (lch) => {
      const c = Color.oklchToRgb(lch.L, lch.C, lch.H);
      return [c.r, c.g, c.b];
    };

    const GAMUT_REL_TOL = 1e-5;
    /**
     * Is an appearance inside the profile's gamut? The round trip is the test: a
     * colour the profile can reproduce comes back close to where it started, and
     * one it cannot is pulled away. (The engine may clip, so channel range alone
     * is not enough.)
     */
    function inGamut(lch) {
      const rgb = oklchToSrgbFloats(lch);
      const back = softProof(rgb);
      const d = Math.max(
        Math.abs(rgb[0] - back[0]),
        Math.abs(rgb[1] - back[1]),
        Math.abs(rgb[2] - back[2]),
      );
      return d <= 0.02 + GAMUT_REL_TOL;
    }

    /** Largest in-gamut chroma at L,H by binary search (a LUT has no cubics).
     * Do not merge this with the interval version below: a binary search from zero
     * under-fills the blue corner, and the LUT path has no channel cubics to
     * enumerate (docs/INVARIANTS.md, "union of chroma intervals"). */
    function maxChroma(L, H, upper = 0.5) {
      const l = Color.clamp01(L);
      if (l <= 0 || l >= 1) return 0;
      if (inGamut({ L: l, C: upper, H })) return upper;
      if (!inGamut({ L: l, C: 1e-4, H })) return 0;
      let lo = 1e-4;
      let hi = upper;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut({ L: l, C: mid, H })) lo = mid; else hi = mid;
      }
      return lo;
    }

    function reduceChroma(L, C, H, upper = 0.5) {
      const l = Color.clamp01(L);
      if (l <= 0 || l >= 1 || C <= 0) return 0;
      if (inGamut({ L: l, C, H })) return C;
      return maxChroma(l, H, C);
    }

    /** One interval for a LUT gamut (the union-of-intervals rule is matrix-only). */
    function chromaIntervals(L, H, upper = 0.5) {
      const max = maxChroma(L, H, upper);
      return max > 0 ? [[0, max]] : [];
    }

    let boundCache = null;
    function maxChromaBound() {
      if (boundCache !== null) return boundCache;
      let best = 0;
      for (let L = 0.01; L <= 0.99; L += 0.05) {
        for (let H = 0; H < 360; H += 15) {
          const c = maxChroma(L, H, 0.6);
          if (c > best) best = c;
        }
      }
      boundCache = best;
      return best;
    }

    function chromaAxis() {
      return Math.ceil(maxChromaBound() * 1.05 * 20) / 20;
    }

    return {
      model,
      profile,
      kind: 'lut',
      srgbToProof,
      proofToSrgb,
      inGamut,
      maxChroma,
      reduceChroma,
      chromaIntervals,
      maxChromaBound,
      chromaAxis,

      /** A recorded value's *print* appearance (sRGB floats). */
      appearanceSrgb(recorded) { return softProof(recorded); },
      /** What to record for an appearance: unchanged — this proof is display-only. */
      recordedSrgb(appearance) { return [appearance[0], appearance[1], appearance[2]]; },

      readOklch(recorded) {
        const a = softProof(recorded);
        return Color.rgbToOklch(a[0], a[1], a[2]);
      },      writeSrgb(lch) { return oklchToSrgbFloats(lch); },
      displaySrgb(lch) { return oklchToSrgbFloats(lch); },
      displaySrgbFromContent(recorded) { return softProof(recorded); },
    };
  }

  /**
   * @param {object} profile parsed profile (from parseIcc)
   * @param {'colorimetric'|'display'|'working'} [model]
   *   Only `working` is UI-reachable (see the module header). The default here
   *   is `colorimetric` for bare callers; the app always passes
   *   `settings.proofModel`, which defaults to `working`.
   */
  function createProof(profile, model = 'colorimetric') {
    if (profile && profile.lut && profile.lut.forward) return createLutProof(profile, model);
    if (!profile.colorants) throw new Error('profile has no colorant matrix (not matrix/TRC)');
    const P = profile.colorants;
    const Pinv = inv3(P);
    const curve = makeCurve(profile.trc || { type: 'identity' });

    const srgbDecode = (c) => Color.srgbToLinear(c);
    const srgbEncode = (c) => Color.linearToSrgb(c);

    // sRGB white in this profile's own record space. The Bradford path targets the
    // D50 white (0.9642, 1, 0.8251) while the profile's colorants sum to a Z that
    // differs by ~5e-4, putting pure white at rec ≈ (1, 1, 1.0006) — just past the
    // gamut tolerance, so #FFFFFF read as out of proof gamut. Normalise to the
    // profile's own white, so a displayed white records as exactly (1, 1, 1).
    const whiteRec = mulVec(Pinv, mulVec(BRADFORD_D65_D50, mulVec(M_SRGB, [1, 1, 1])));
    const toRec = (xyzD50) => {
      const rec = mulVec(Pinv, xyzD50);
      return [rec[0] / whiteRec[0], rec[1] / whiteRec[1], rec[2] / whiteRec[2]];
    };
    const fromRec = (rec) => [rec[0] * whiteRec[0], rec[1] * whiteRec[1], rec[2] * whiteRec[2]];

    /** sRGB (gamma floats) -> proof-space encoded values. */
    function srgbToProof(rgb) {
      const lin = [srgbDecode(rgb[0]), srgbDecode(rgb[1]), srgbDecode(rgb[2])];
      const rec = toRec(mulVec(BRADFORD_D65_D50, mulVec(M_SRGB, lin)));
      return [curve.encode(rec[0]), curve.encode(rec[1]), curve.encode(rec[2])];
    }

    /** proof-space encoded values -> sRGB (gamma floats). */
    function proofToSrgb(proof) {
      const rec = fromRec([curve.decode(proof[0]), curve.decode(proof[1]), curve.decode(proof[2])]);
      const xyzD65 = mulVec(BRADFORD_D50_D65, mulVec(P, rec));
      const lin = mulVec(M_SRGB_INV, xyzD65);
      return [srgbEncode(lin[0]), srgbEncode(lin[1]), srgbEncode(lin[2])];
    }

    const identity = (v) => [v[0], v[1], v[2]];
    // How values recorded by CSP map to what you see, and back.
    const toAppearance = model === 'working' ? proofToSrgb : model === 'display' ? srgbToProof : identity;
    const toRecorded = model === 'working' ? srgbToProof : model === 'display' ? proofToSrgb : identity;

    const oklchToSrgbFloats = (lch) => {
      const c = Color.oklchToRgb(lch.L, lch.C, lch.H);
      return [c.r, c.g, c.b];
    };

    // Tolerance relative to the colour's own magnitude. Near black the linear
    // channels are ~1e-9, so an absolute epsilon would accept a spurious chroma
    // and leave a spike at the dark end of the lightness plot.
    const GAMUT_REL_TOL = 1e-5;
    /** Is an appearance OKLCH representable by CSP (linear profile channels in range)? */
    function inGamut(lch) {
      const lin = Color.oklchToLinearRgb(lch.L, lch.C, lch.H);
      const xyzD50 = mulVec(BRADFORD_D65_D50, mulVec(M_SRGB, [lin.r, lin.g, lin.b]));
      const rec = toRec(xyzD50);
      const scale = Math.max(Math.abs(rec[0]), Math.abs(rec[1]), Math.abs(rec[2]), 1e-9);
      const eps = GAMUT_REL_TOL * scale;
      return rec[0] >= -eps && rec[0] <= 1 + eps &&
             rec[1] >= -eps && rec[1] <= 1 + eps &&
             rec[2] >= -eps && rec[2] <= 1 + eps;
    }

    // Recorded (profile-space) channels as cubics in chroma at fixed L,H: the
    // transform from linear sRGB is a matrix, so it maps the channel cubics to
    // cubics. See Color#linearRgbChromaCubic.
    const M_REC = mulMat(Pinv, mulMat(BRADFORD_D65_D50, M_SRGB))
      .map((row, i) => row.map((v) => v / whiteRec[i]));
    function recChromaCubic(L, H) {
      const rgb = Color.linearRgbChromaCubic(L, H);
      const out = [];
      for (let row = 0; row < 3; row++) {
        const co = [0, 0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const w = M_REC[row][k];
          for (let j = 0; j < 4; j++) co[j] += w * rgb[k][j];
        }
        out.push(co);
      }
      return out;
    }

    /** In-gamut chroma intervals at this lightness and hue (see Color). */
    function chromaIntervals(L, H, upper = 0.5) {
      const l = Color.clamp01(L);
      if (l <= 0 || l >= 1) return [];
      return Color.chromaIntervalsFromCubics(recChromaCubic(l, H), upper, (c) => inGamut({ L: l, C: c, H }));
    }

    /**
     * Largest in-gamut chroma, outermost interval so a primary corner stays
     * reachable (a plain search from zero under-fills near the corners).
     */
    function maxChroma(L, H, upper = 0.5) {
      const l = Color.clamp01(L);
      if (l <= 0 || l >= 1) return 0;
      const iv = chromaIntervals(l, H, upper);
      return iv.length ? iv[iv.length - 1][1] : 0;
    }

    /** Largest in-gamut chroma <= C (snapping; never raises C). */
    function reduceChroma(L, C, H, upper = 0.5) {
      const l = Color.clamp01(L);
      if (l <= 0 || l >= 1 || C <= 0) return 0;
      if (inGamut({ L: l, C, H })) return C;
      const iv = chromaIntervals(l, H, Math.max(upper, C));
      let best = 0;
      for (const [, b] of iv) if (b <= C && b > best) best = b;
      return best;
    }

    let boundCache = null;
    /** Largest chroma anywhere in this gamut (cached; used for the UI axis). */
    function maxChromaBound() {
      if (boundCache !== null) return boundCache;
      let best = 0;
      for (let L = 0.01; L <= 0.99; L += 0.01) {
        for (let H = 0; H < 360; H += 3) {
          const c = maxChroma(L, H, 0.6);
          if (c > best) best = c;
        }
      }
      boundCache = best;
      return best;
    }

    /** An axis upper bound that comfortably contains the whole gamut. */
    function chromaAxis() {
      return Math.ceil(maxChromaBound() * 1.05 * 20) / 20;
    }

    return {
      model,
      profile,
      srgbToProof,
      proofToSrgb,
      inGamut,
      maxChroma,
      reduceChroma,
      chromaIntervals,
      maxChromaBound,
      chromaAxis,

      /** What a value recorded by CSP looks like (sRGB floats). */
      appearanceSrgb(recorded) { return toAppearance(recorded); },
      /** What to record in CSP for a desired appearance (sRGB floats). */
      recordedSrgb(appearance) { return toRecorded(appearance); },

      /** OKLCH of the appearance for a colour recorded by CSP. */
      readOklch(recorded) {
        const a = toAppearance(recorded);
        return Color.rgbToOklch(a[0], a[1], a[2]);
      },      /** The value to send to CSP for an OKLCH of the appearance. */
      writeSrgb(lch) { return toRecorded(oklchToSrgbFloats(lch)); },
      /** sRGB that renders this appearance in our (sRGB) window. */
      displaySrgb(lch) { return oklchToSrgbFloats(lch); },
      /** How a recorded colour looks (for UI chips). */
      displaySrgbFromContent(recorded) { return toAppearance(recorded); },
      /** Document encoded RGB (0..1 per channel) <-> OKLab, for the model reference. */
      recordToOklab(recorded) {
        const a = proofToSrgb(recorded);
        return Color.rgbToOklab(a[0], a[1], a[2]);
      },
      oklabToRecord(lab) {
        const s = Color.oklabToRgb(lab.L, lab.a, lab.b);
        return srgbToProof([s.r, s.g, s.b]);
      },
      /**
       * Linear document RGB <-> OKLab (no TRC). The Ottosson steps work in linear
       * light; `toRec`/`fromRec` are the profile's own white-normalised coordinates.
       * Out-of-cube values are allowed (they are the "outside the wall" colours).
       */
      oklabToLinearRecord(lab) {
        const lin = Color.oklabToLinearRgb(lab.L, lab.a, lab.b);
        const xyzD50 = mulVec(BRADFORD_D65_D50, mulVec(M_SRGB, [lin.r, lin.g, lin.b]));
        return toRec(xyzD50);
      },
      linearRecordToOklab(rec) {
        const xyzD65 = mulVec(BRADFORD_D50_D65, mulVec(P, fromRec(rec)));
        const lin = mulVec(M_SRGB_INV, xyzD65);
        return Color.linearRgbToOklab(lin[0], lin[1], lin[2]);
      },
    };
  }

  return { parseIcc, createProof, createLutProof, pickAdobeRgbProfileName, mulVec, mulMat, inv3, M_SRGB, M_SRGB_INV, BRADFORD_D65_D50, BRADFORD_D50_D65, D50, D65 };
});

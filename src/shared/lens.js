/*
 * A lens: a transform that sits over a selector's colour map.
 *
 * The v1 lens is **Quantize** — a per-channel bit grid over the *document's* channels,
 * so every colour the map shows is a colour the document can actually hold and record.
 * Quantizing in the document's own channels is what keeps an Adobe RGB document's
 * saturated colours reachable; masking the display's sRGB bytes would quietly cap the
 * reachable gamut at sRGB instead.
 *
 * Two rules make a lens safe, and both live here:
 *
 * 1. **The pick half is not optional.** The map paints `applySrgb(...)` and the picker
 *    records the same function's result, so a shown colour is always the recorded
 *    colour. This module is the single implementation both call — a lens that moved the
 *    bitmap but not the picker would be the same bug as a display-only rotate.
 * 2. **A band colour is always a real document colour.** Document channels are clamped
 *    to 0..1 before quantizing, so the result is on the grid *and* inside the document's
 *    gamut by construction — no out-of-gamut search, no snap that can move it off the
 *    grid. (docs/INVARIANTS.md, "a lensed pick is on the grid and in gamut")
 *
 * Cost: the display colour of a band is a property of the band alone, so it is
 * precomputed once per (profile, bits) into a table and looked up per pixel. A pixel
 * pays one document conversion; at 3 bits the table is 512 entries.
 *
 * Loads as CommonJS in Node and as a global `IroLens` in the renderer.
 * Unit-tested in `test/lens.test.js`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroLens = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CHANNELS = 3;
  const MIN_BITS = 1;
  const MAX_BITS = 8;

  // Above this many bands (`2^sum(bits)`) a display table costs more than it saves, so
  // `applySrgb` converts through the profile per pixel instead. 262,144 entries is
  // 6 bits per channel; 7 and 8 bits take the direct path.
  const MAX_TABLE = 1 << 18;

  const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

  /** Three clamped bit depths; anything missing or silly becomes the default 3. */
  function normaliseBits(bits) {
    const out = new Array(CHANNELS);
    for (let i = 0; i < CHANNELS; i++) {
      const n = Math.round(Number(Array.isArray(bits) ? bits[i] : NaN));
      out[i] = Number.isFinite(n) ? Math.min(MAX_BITS, Math.max(MIN_BITS, n)) : 3;
    }
    return out;
  }

  const label = (bits) => bits.join('/');
  const countFor = (bits) => bits.reduce((n, b) => n * (1 << b), 1);
  const inert = (bits) => bits.every((b) => b === MAX_BITS);

  /**
   * Read the stored lens spec off a module instance's settings.
   * @returns {{active: (string|null), bits: number[]}}
   */
  function parseSpec(raw) {
    const spec = raw && typeof raw === 'object' ? raw : {};
    const q = spec.quantize && typeof spec.quantize === 'object' ? spec.quantize : {};
    return {
      active: spec.active === 'quantize' ? 'quantize' : null,
      bits: normaliseBits(q.bits),
    };
  }

  /**
   * Build a lens.
   *
   * @param {object} opts
   * @param {number[]} opts.bits  bits per document channel
   * @param {Function} [opts.toDoc]   `(r,g,b) => [d0,d1,d2]` display sRGB floats ->
   *        document channels. Absent means the document *is* sRGB (no profile).
   * @param {Function} [opts.fromDoc] `(d0,d1,d2) => [r,g,b]` document channels ->
   *        display sRGB floats. Absent means identity.
   * @param {Function} [opts.docToLab] `(d0,d1,d2) => {L,a,b}` the store's colour for a
   *        recorded document value. Absent falls back to `fromDoc` then sRGB -> OKLab.
   * @returns {object} the lens
   */
  function create(opts = {}) {
    const bits = normaliseBits(opts.bits);
    const toDoc = typeof opts.toDoc === 'function' ? opts.toDoc : null;
    const fromDoc = typeof opts.fromDoc === 'function' ? opts.fromDoc : null;
    const docToLab = typeof opts.docToLab === 'function' ? opts.docToLab : null;

    const levels = bits.map((b) => 1 << b);
    const steps = bits.map((b) => (1 << b) - 1);
    const size = countFor(bits);
    const isInert = inert(bits);
    const sameSpace = !toDoc && !fromDoc;

    // Per-call scratch, so a raster loop allocates nothing.
    const doc = [0, 0, 0];
    const docIn = [0, 0, 0];

    /** Display floats -> document floats, `docIn` when the document *is* sRGB. */
    function toDocument(r, g, b) {
      if (toDoc) return toDoc(r, g, b);
      docIn[0] = r; docIn[1] = g; docIn[2] = b;
      return docIn;
    }

    /** Document floats -> the grid, in place on `doc`'s shape. */
    function quantizeDoc(d0, d1, d2, out) {
      const c = out || [0, 0, 0];
      c[0] = Math.round(clamp01(d0) * steps[0]) / steps[0];
      c[1] = Math.round(clamp01(d1) * steps[1]) / steps[1];
      c[2] = Math.round(clamp01(d2) * steps[2]) / steps[2];
      return c;
    }

    /** The band index of a document triple, `(i0 * levels1 + i1) * levels2 + i2`. */
    function indexOf(d0, d1, d2) {
      const i0 = Math.round(clamp01(d0) * steps[0]);
      const i1 = Math.round(clamp01(d1) * steps[1]);
      const i2 = Math.round(clamp01(d2) * steps[2]);
      return (i0 * levels[1] + i1) * levels[2] + i2;
    }

    /** Document triple of a band index. */
    function docAt(index, out) {
      const c = out || [0, 0, 0];
      const i2 = index % levels[2];
      const rest = (index - i2) / levels[2];
      const i1 = rest % levels[1];
      const i0 = (rest - i1) / levels[1];
      c[0] = i0 / steps[0];
      c[1] = i1 / steps[1];
      c[2] = i2 / steps[2];
      return c;
    }

    // The display colour of every band, precomputed: `Float32Array(size * 3)`.
    // Only when the conversion is not the identity and the grid is small enough.
    let table = null;
    if (!isInert && !sameSpace && size <= MAX_TABLE) {
      table = new Float32Array(size * CHANNELS);
      const d = [0, 0, 0];
      for (let i = 0; i < size; i++) {
        docAt(i, d);
        const s = fromDoc ? fromDoc(d[0], d[1], d[2]) : d;
        table[i * 3] = s[0];
        table[i * 3 + 1] = s[1];
        table[i * 3 + 2] = s[2];
      }
    }

    /** Display sRGB floats of one band, written into `out`. */
    function displayAt(index, out) {
      const c = out || [0, 0, 0];
      if (table) {
        c[0] = table[index * 3];
        c[1] = table[index * 3 + 1];
        c[2] = table[index * 3 + 2];
        return c;
      }
      docAt(index, doc);
      const s = fromDoc ? fromDoc(doc[0], doc[1], doc[2]) : doc;
      c[0] = s[0]; c[1] = s[1]; c[2] = s[2];
      return c;
    }

    /**
     * The lens in one call: display sRGB floats in, the band's display sRGB floats out.
     * This is what both the raster and the pick use.
     */
    function applySrgb(r, g, b, out) {
      const c = out || [0, 0, 0];
      if (isInert) {
        c[0] = r; c[1] = g; c[2] = b;
        return c;
      }
      if (sameSpace) {
        // The document is sRGB, so the band *is* the display colour.
        c[0] = Math.round(clamp01(r) * steps[0]) / steps[0];
        c[1] = Math.round(clamp01(g) * steps[1]) / steps[1];
        c[2] = Math.round(clamp01(b) * steps[2]) / steps[2];
        return c;
      }
      const d = toDocument(r, g, b);
      return displayAt(indexOf(d[0], d[1], d[2]), c);
    }

    /**
     * The store's colour for a lensed display colour: what the pick records. Steps
     * through the document so a wide-gamut value keeps its chroma instead of being
     * squeezed into sRGB and back.
     */
    function applyLab(lab, rgbToLab, oklabToRgb) {
      if (isInert) return { L: lab.L, a: lab.a, b: lab.b };
      const rgb = oklabToRgb(lab.L, lab.a, lab.b);
      // Exactly the document value `applySrgb` derives for this pixel, so the pick and
      // the painted pixel are the same band by construction.
      const d = toDocument(rgb.r, rgb.g, rgb.b);
      const q = quantizeDoc(d[0], d[1], d[2], doc);
      if (docToLab) return docToLab(q[0], q[1], q[2]);
      const back = fromDoc ? fromDoc(q[0], q[1], q[2]) : q;
      return rgbToLab(back[0], back[1], back[2]);
    }

    return {
      id: 'quantize',
      bits,
      levels,
      size,
      inert: isInert,
      channels: CHANNELS,
      sameSpace,
      hasTable: table !== null,
      label: label(bits),
      count: size,
      quantizeDoc,
      indexOf,
      docAt,
      displayAt,
      applySrgb,
      applyLab,
    };
  }

  return {
    CHANNELS,
    MIN_BITS,
    MAX_BITS,
    MAX_TABLE,
    normaliseBits,
    parseSpec,
    label,
    countFor,
    inert,
    create,
  };
});

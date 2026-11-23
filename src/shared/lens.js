
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroLens = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CHANNELS = 3;
  const MIN_BITS = 1;
  const MAX_BITS = 8;

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

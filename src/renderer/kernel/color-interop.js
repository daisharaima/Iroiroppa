'use strict';

// The colour-library interop layer (docs/STATE.md, §12.15.4).
//
// culori (MIT) is used only AROUND the core — CSS parsing, space breadth,
// interpolation and colour-difference — never for the gamut-interval maths, the
// ICC proof transform or the canonical OKLab value (§12.15.2). It is optional:
// every method checks for it and returns null when the vendored bundle is not
// loaded, so the app is byte-for-byte unaffected when culori is absent.
//
// This is the ONLY module that references `culori`, so the dependency stays
// swappable. Values cross the boundary as OKLab `{ L, a, b }` / hex, matching the
// app's own conventions.

(function () {
  const culori = typeof window !== 'undefined' ? window.culori : undefined;
  const available = Boolean(culori);

  function toOklab(hex) {
    if (!available || typeof hex !== 'string') return null;
    try {
      const c = culori.oklab(hex.trim());
      return c ? { L: c.l, a: c.a, b: c.b } : null;
    } catch { return null; }
  }

  function fromOklab(lab, space = 'oklab') {
    if (!available || !lab) return null;
    try {
      const colour = { mode: 'oklab', l: lab.L, a: lab.a, b: lab.b };
      // 'hex' is a formatter, not a converter mode: converter('hex') has no rgb
      // formatter and throws, which used to make every hex request return null.
      if (space === 'hex' || space === 'rgb') return culori.formatHex(colour);
      return culori.converter(space)(colour);
    } catch { return null; }
  }

  /** Parse any CSS colour string to OKLab + hex, or null when unknown. */
  function parseCssColor(str) {
    if (!available || typeof str !== 'string' || !str.trim()) return null;
    try {
      const c = culori.parse(str.trim());
      if (!c) return null;
      const lab = culori.oklab(c);
      return { L: lab.l, a: lab.a, b: lab.b, hex: culori.formatHex(c) };
    } catch { return null; }
  }

  /**
   * A perceptual difference between two colours. The default is Euclidean
   * distance in OKLab (computed here); a named culori metric (e.g. 'ciede2000')
   * is delegated. Returns a number, or null when culori is absent.
   */
  function difference(a, b, metric = 'oklab') {
    if (!available) return null;
    try {
      const ca = typeof a === 'string' ? culori.parse(a) : a;
      const cb = typeof b === 'string' ? culori.parse(b) : b;
      if (!ca || !cb) return null;
      if (metric && metric !== 'oklab') {
        // culori exposes metrics as factories (differenceCiede2000() …), not as
        // culori.difference(a, b, name); that name was undefined.
        const factory = metric === 'ciede2000' ? culori.differenceCiede2000
          : metric === 'cie76' ? () => culori.differenceEuclidean('lab')
            : null;
        const fn = factory ? factory() : null;
        return fn ? fn(ca, cb) : null;
      }
      const la = culori.oklab(ca);
      const lb = culori.oklab(cb);
      return Math.hypot(la.l - lb.l, la.a - lb.a, la.b - lb.b);
    } catch { return null; }
  }

  /** Interpolate two colours; `opts` is culori's (e.g. `{ space: 'oklch' }`). */
  function interpolate(a, b, t, opts) {
    if (!available) return null;
    try {
      const ca = typeof a === 'string' ? culori.parse(a) : a;
      const cb = typeof b === 'string' ? culori.parse(b) : b;
      if (!ca || !cb) return null;
      // culori takes a mode name; the callers' `{ space: 'oklch' }` shape is accepted too.
      const mode = typeof opts === 'string' ? opts : ((opts && opts.space) || 'oklab');
      return culori.interpolate([ca, cb], mode)(t);
    } catch { return null; }
  }

  /** The closest entry in `list` (`[{ name, hex }]`) to `hex`. */
  function nearestName(hex, list) {
    if (!available || !Array.isArray(list) || !list.length) return null;
    let best = null;
    for (const entry of list) {
      if (!entry || typeof entry.hex !== 'string') continue;
      const d = difference(hex, entry.hex, 'oklab');
      if (d == null) continue;
      if (!best || d < best.distance) best = { name: entry.name, hex: entry.hex, distance: d };
    }
    return best;
  }

  window.Iro = window.Iro || {};
  window.Iro.colorInterop = { available, toOklab, fromOklab, parseCssColor, difference, interpolate, nearestName };
})();

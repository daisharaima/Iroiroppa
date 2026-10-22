/*
 * Colour models — the per-picker views over the canonical OKLab value.
 *
 * The canonical internal colour is OKLab (docs/COLOR.md); a "model" is a way to
 * parameterise that appearance with three axes, chosen per picker instance. A
 * model NEVER owns colour and never touches a device or display space: it only
 * converts between its own axes and OKLab.
 *
 * Loads as CommonJS in Node and as a global `IroColorModels` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./color'));
  else root.IroColorModels = factory(root.Color);
})(typeof self !== 'undefined' ? self : this, function (Color) {
  'use strict';

  /**
   * A model is:
   *   {
   *     id, name,
   *     axes: [{ key, label, min, max, fmt }],   // three axes, in display order
   *     fromLab(lab) -> [x, y, z],               // OKLab -> axes (readout & cursor)
   *     toLab([x, y, z]) -> { L, a, b },         // axes -> OKLab (for setLab)
   *   }
   * `fmt` is the decimal places for the readout. `axes[1]` is the vertical axis
   * by convention (chroma-like for the pickers).
   */
  const models = [];
  const byId = new Map();

  function register(model) {
    if (!model || !model.id) throw new Error('a colour model needs an id');
    if (!Array.isArray(model.axes) || model.axes.length !== 3) {
      throw new Error(`model ${model.id} needs exactly three axes`);
    }
    if (typeof model.fromLab !== 'function' || typeof model.toLab !== 'function') {
      throw new Error(`model ${model.id} needs fromLab() and toLab()`);
    }
    if (byId.has(model.id)) {
      const i = models.findIndex((m) => m.id === model.id);
      models[i] = model;
    } else {
      models.push(model);
    }
    byId.set(model.id, model);
    return model;
  }

  const get = (id) => byId.get(id) || null;
  const list = () => models.slice();
  const ids = () => models.map((m) => m.id);
  const has = (id) => byId.has(id);

  const DEFAULT_ID = 'oklch';

  // The three planes a slice shows, each as [horizontalAxis, verticalAxis,
  // fixedAxis]. This convention reproduces OKLCH's (L,C) / (H,C) / (H,L) panels
  // and generalises to any three-axis model.
  const PLANES = [[0, 1, 2], [2, 1, 0], [2, 0, 1]];

  /** Current axis values for a model, with the store's hue anchor substituted at
   *  zero chroma/saturation (a rectangular value has no hue there). */
  function axesFor(model, store) {
    const axes = model.fromLab(store.lab());
    if (model.hueIndex != null && Math.abs(axes[1] - model.axes[1].min) < 1e-9) {
      axes[model.hueIndex] = store.H;
    }
    return axes;
  }

  /** Axis range; the caller may override chroma-like axes for the working gamut. */
  function axisRange(model, i) {
    return { min: model.axes[i].min, max: model.axes[i].max };
  }

  /** Format an axis value for display: `scale` multiplies (e.g. L 0..1 -> 0..100). */
  function formatAxis(def, value) {
    const v = value * (def.scale == null ? 1 : def.scale);
    return def.fmt ? v.toFixed(def.fmt) : String(Math.round(v));
  }

  // --- OKLCH — the reference view (the app's original axes) -----------------
  register({
    id: 'oklch',
    name: 'OKLCH',
    axes: [
      { key: 'l', label: 'L', min: 0, max: 1, scale: 100, fmt: 0 },
      { key: 'c', label: 'C', min: 0, max: 0.4, scale: 1000, fmt: 0 },
      { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1 },
    ],
    hueIndex: 2,
    fromLab(lab) {
      return [lab.L, Math.hypot(lab.a, lab.b), Color.mod360((Math.atan2(lab.b, lab.a) * 180) / Math.PI)];
    },
    toLab(axes) {
      return Color.oklchToOklab(axes[0], axes[1], axes[2]);
    },
  });

  // --- CIELAB (D65) ---------------------------------------------------------
  // Defined everywhere (a wide-gamut document needs it out of the sRGB gamut),
  // but the dark, far-out-of-gamut corners round-trip only to ~1e-2.
  register({
    id: 'lab',
    name: 'Lab',
    tol: 1e-2,
    axes: [
      { key: 'l', label: 'L', min: 0, max: 100, scale: 1, fmt: 1 },
      { key: 'a', label: 'a', min: -128, max: 128, scale: 1, fmt: 1 },
      { key: 'b', label: 'b', min: -128, max: 128, scale: 1, fmt: 1 },
    ],
    fromLab(lab) {
      const v = Color.oklabToLab(lab.L, lab.a, lab.b);
      return [v.L, v.a, v.b];
    },
    toLab(axes) {
      return Color.labToOklab(axes[0], axes[1], axes[2]);
    },
  });

  // --- OKHSV (sRGB-referenced) ----------------------------------------------
  // Ottosson's Okhsv. Its s/v are relative to the *sRGB* gamut, so it is only
  // meaningful inside sRGB; a wider working profile should use OKLCH or Lab.
  register({
    id: 'okhsv',
    name: 'OKHSV',
    hueIndex: 0,
    // Dense: every in-range axis value maps to an sRGB colour — no out-of-gamut.
    dense: true,
    domain(lab) {
      const l = Color.oklabToLinearRgb(lab.L, lab.a, lab.b);
      const eps = 1e-6;
      return l.r >= -eps && l.r <= 1 + eps && l.g >= -eps && l.g <= 1 + eps && l.b >= -eps && l.b <= 1 + eps;
    },
    axes: [
      { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1 },
      { key: 's', label: 'S', min: 0, max: 1, scale: 100, fmt: 0 },
      { key: 'v', label: 'V', min: 0, max: 1, scale: 100, fmt: 0 },
    ],
    fromLab(lab) {
      const v = Color.oklabToOkhsv(lab.L, lab.a, lab.b);
      return [v.h, v.s, v.v];
    },
    toLab(axes) {
      return Color.okhsvToOklab(axes[0], axes[1], axes[2]);
    },
  });

  // --- device HSV / HSL (sRGB-referenced) ------------------------------------
  // The familiar picker spaces. Like Okhsv they are relative to the *sRGB* gamut.
  const inSrgb = (lab) => {
    const l = Color.oklabToLinearRgb(lab.L, lab.a, lab.b);
    const eps = 1e-6;
    return l.r >= -eps && l.r <= 1 + eps && l.g >= -eps && l.g <= 1 + eps && l.b >= -eps && l.b <= 1 + eps;
  };

  register({
    id: 'hsv',
    name: 'HSV',
    hueIndex: 0,
    dense: true,
    domain: inSrgb,
    axes: [
      { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1 },
      { key: 's', label: 'S', min: 0, max: 1, scale: 100, fmt: 0 },
      { key: 'v', label: 'V', min: 0, max: 1, scale: 100, fmt: 0 },
    ],
    fromLab(lab) {
      const c = Color.oklabToRgb(lab.L, lab.a, lab.b);
      const x = Color.rgbToHsv(c.r, c.g, c.b);
      return [x.h, x.s, x.v];
    },
    toLab(axes) {
      const c = Color.hsvToRgb(axes[0], axes[1], axes[2]);
      return Color.rgbToOklab(c.r, c.g, c.b);
    },
  });

  register({
    id: 'hsl',
    name: 'HSL',
    hueIndex: 0,
    dense: true,
    domain: inSrgb,
    axes: [
      { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1 },
      { key: 's', label: 'S', min: 0, max: 1, scale: 100, fmt: 0 },
      { key: 'l', label: 'L', min: 0, max: 1, scale: 100, fmt: 0 },
    ],
    fromLab(lab) {
      const c = Color.oklabToRgb(lab.L, lab.a, lab.b);
      const x = Color.rgbToHsl(c.r, c.g, c.b);
      return [x.h, x.s, x.l];
    },
    toLab(axes) {
      const c = Color.hslToRgb(axes[0], axes[1], axes[2]);
      return Color.rgbToOklab(c.r, c.g, c.b);
    },
  });

  return { register, get, list, ids, has, DEFAULT_ID, PLANES, axesFor, axisRange, formatAxis };
});

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
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./color'), require('../renderer/vendor/helmlab/helmlab.umd.js'));
  } else {
    root.IroColorModels = factory(root.Color, root.helmlab);
  }
})(typeof self !== 'undefined' ? self : this, function (Color, Helm) {
  'use strict';

  /**
   * A model is:
   *   {
   *     id, name,
   *     axes: [{ key, label, min, max, fmt }],   // three axes, in display order
   *     fromLab(lab) -> [x, y, z],               // OKLab -> axes (readout & cursor)
   *     toLab([x, y, z]) -> { L, a, b },         // axes -> OKLab (for setLab)
   *     isAchromatic(axes)? -> boolean           // where the hue anchor applies
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
    if (model.hueIndex != null) {
      const achromatic = typeof model.isAchromatic === 'function'
        ? model.isAchromatic(axes)
        : Math.abs(axes[1] - model.axes[1].min) < 1e-9;
      if (achromatic) axes[model.hueIndex] = store.H;
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

  // --- OKLab — the canonical value as a model -------------------------------
  // The rectangular parent every other view derives from: a model like any
  // other (so a slice can show the a-b plane), but with no hue axis. The a/b
  // range is wide enough for the widest working profile the proof can show.
  register({
    id: 'oklab',
    name: 'OKLab',
    axes: [
      { key: 'l', label: 'L', min: 0, max: 1, scale: 100, fmt: 0 },
      { key: 'a', label: 'a', min: -0.4, max: 0.4, scale: 1, fmt: 3 },
      { key: 'b', label: 'b', min: -0.4, max: 0.4, scale: 1, fmt: 3 },
    ],
    fromLab(lab) {
      return [lab.L, lab.a, lab.b];
    },
    toLab(axes) {
      return { L: axes[0], a: axes[1], b: axes[2] };
    },
  });

  // --- Okhsv / Okhsl / Okhwb (sRGB-referenced picker spaces) -----------------
  // Ottosson's three perceptual picks, all defined against sRGB: their S/V/W/B
  // axes are only meaningful inside it, so `domain` limits the round-trip and
  // `dense` says every axis value maps to a colour (no out-of-gamut area).
  const inSrgb = (lab) => {
    const l = Color.oklabToLinearRgb(lab.L, lab.a, lab.b);
    const eps = 1e-6;
    return l.r >= -eps && l.r <= 1 + eps && l.g >= -eps && l.g <= 1 + eps && l.b >= -eps && l.b <= 1 + eps;
  };

  register({
    id: 'okhsv',
    name: 'OKHSV',
    hueIndex: 0,
    dense: true,
    domain: inSrgb,
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

  register({
    id: 'okhsl',
    name: 'OKHSL',
    hueIndex: 0,
    dense: true,
    domain: inSrgb,
    axes: [
      { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1 },
      { key: 's', label: 'S', min: 0, max: 1, scale: 100, fmt: 0 },
      { key: 'l', label: 'L', min: 0, max: 1, scale: 100, fmt: 0 },
    ],
    fromLab(lab) {
      const v = Color.oklabToOkhsl(lab.L, lab.a, lab.b);
      return [v.h, v.s, v.l];
    },
    toLab(axes) {
      return Color.okhslToOklab(axes[0], axes[1], axes[2]);
    },
  });

  // Okhwb is Okhsv re-parameterised: w = v(1-s), b = 1-v. Its hue is undefined on
  // the *neutral axis* w = 1-b, not at w = 0, so it carries its own achromatic
  // test (the contract's default checks the second axis at its minimum).
  register({
    id: 'okhwb',
    name: 'OKHWB',
    hueIndex: 0,
    dense: true,
    domain: inSrgb,
    isAchromatic(axes) {
      return Math.abs(axes[1] - (1 - axes[2])) < 1e-6;
    },
    axes: [
      { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1 },
      { key: 'w', label: 'W', min: 0, max: 1, scale: 100, fmt: 0 },
      { key: 'b', label: 'B', min: 0, max: 1, scale: 100, fmt: 0 },
    ],
    fromLab(lab) {
      const v = Color.oklabToOkhwb(lab.L, lab.a, lab.b);
      return [v.h, v.w, v.b];
    },
    toLab(axes) {
      return Color.okhwbToOklab(axes[0], axes[1], axes[2]);
    },
  });

  // --- HelmGen (Helmlab GenSpace): the cylindrical and the rectangular view --
  // Two views over ONE space (docs/COLOR.md): `helmgenlch` is the polar form a
  // picker needs, `helmgen` the rectangular parent (no hue axis, like OKLab).
  // Helmlab's entry point is XYZ (D65), so both adapters hop OKLab -> linear RGB
  // -> XYZ -> GenLab. `gen.space` is the raw space: the `gen` facade has no
  // toXyz. The vendored bundle is optional — without it these models simply do
  // not exist rather than taking the picker down.
  if (Helm && Helm.Helmlab) {
    // The module exports the classes; the facade (gen/metric/tokens) lives on an
    // instance.
    const gen = new Helm.Helmlab().gen;
    const helmXyz = (lab) => {
      const lin = Color.oklabToLinearRgb(lab.L, lab.a, lab.b);
      const v = Color.linearRgbToXyz(lin.r, lin.g, lin.b);
      return [v.X, v.Y, v.Z];
    };
    const helmLab = (xyz) => {
      const lin = Color.xyzToLinearRgb(xyz[0], xyz[1], xyz[2]);
      return Color.linearRgbToOklab(lin.r, lin.g, lin.b);
    };

    register({
      id: 'helmgenlch',
      name: 'HelmGen LCH',
      hueIndex: 2,
      domain: inSrgb,
      axes: [
        { key: 'l', label: 'L', min: 0, max: 1, scale: 100, fmt: 0 },
        { key: 'c', label: 'C', min: 0, max: 0.65, scale: 1000, fmt: 0 },
        { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1 },
      ],
      fromLab(lab) {
        const lch = gen.toLch(gen.space.fromXYZ(helmXyz(lab)));
        return [lch[0], lch[1], lch[2]];
      },
      toLab(axes) {
        return helmLab(gen.space.toXYZ(gen.lch(axes[0], axes[1], axes[2])));
      },
    });

    register({
      id: 'helmgen',
      name: 'HelmGen',
      domain: inSrgb,
      axes: [
        { key: 'l', label: 'L', min: 0, max: 1, scale: 100, fmt: 0 },
        { key: 'a', label: 'a', min: -0.45, max: 0.45, scale: 1, fmt: 3 },
        { key: 'b', label: 'b', min: -0.6, max: 0.6, scale: 1, fmt: 3 },
      ],
      fromLab(lab) {
        const v = gen.space.fromXYZ(helmXyz(lab));
        return [v[0], v[1], v[2]];
      },
      toLab(axes) {
        return helmLab(gen.space.toXYZ(gen.lab(axes[0], axes[1], axes[2])));
      },
    });
  }

  return { register, get, list, ids, has, DEFAULT_ID, PLANES, axesFor, axisRange, formatAxis };
});

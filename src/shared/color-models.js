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

  // --- The RGB cube the HSV/HSL/HWB-shaped models are built on ------------------
  // OKHSV/OKHSL/OKHWB are HSV/HSL/HWB-shaped, and that shape is defined by an RGB
  // cube. Ottosson's versions are the sRGB-specific ones, so their axes stop at the
  // sRGB gamut. `document` swaps in the active profile's cube (a matrix/TRC RGB
  // profile), which makes the three spaces reach every colour the document holds;
  // `srgb` keeps the sRGB-referenced definitions (and the "sRGB reference" notice).
  const SRGB_REFERENCE = { kind: 'srgb', limited: true };
  let reference = SRGB_REFERENCE;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

  /** Point the three RGB-referenced models at a cube or a gamut ({kind:'document'|'gamut'}). */
  function setReference(next) {
    reference = next && next.gamut ? next : SRGB_REFERENCE;
  }

  /** True while a model can only name sRGB colours (the Slices/Disc notice). */
  function referenceLimited(model) {
    return !reference.gamut
      && Boolean(model)
      && (model.id === 'okhsv' || model.id === 'okhsl' || model.id === 'okhwb');
  }

  function register(model) {
    if (!model || !model.id) throw new Error('a colour model needs an id');
    if (!Array.isArray(model.axes) || model.axes.length !== 3) {
      throw new Error(`model ${model.id} needs exactly three axes`);
    }
    if (typeof model.fromLab !== 'function' || typeof model.toLab !== 'function') {
      throw new Error(`model ${model.id} needs fromLab() and toLab()`);
    }
    if (!model.family) model.family = model.id.startsWith('helmgen') ? 'helmgen' : 'oklab';
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
  const FAMILY_IDS = ['all', 'oklab', 'cielab', 'helmgen', 'hct'];
  const normalizeFamily = (value) => (FAMILY_IDS.includes(value) ? value : 'all');
  const families = () => [...new Set(models.map((m) => m.family))];
  const familyOf = (model) => (model && model.family) || 'oklab';
  const inFamily = (model, family) => family === 'all' || !family || familyOf(model) === family;
  const listForFamily = (family) => models.filter((m) => inFamily(m, family));
  const defaultForFamily = (family) => {
    if (family === 'cielab') return byId.has('cielch') ? 'cielch' : DEFAULT_ID;
    if (family === 'helmgen') return byId.has('helmgenlch') ? 'helmgenlch' : DEFAULT_ID;
    if (family === 'hct') return byId.has('hct') ? 'hct' : DEFAULT_ID;
    return DEFAULT_ID;
  };
  const has = (id) => byId.has(id);

  const DEFAULT_ID = 'oklch';

  // The three planes a slice shows, each as [horizontalAxis, verticalAxis,
  // fixedAxis]. This convention reproduces OKLCH's (L,C) / (H,C) / (H,L) panels
  // and generalises to any three-axis model. Rectangular models (no hue axis)
  // keep this order; a hue model derives its planes from the axis roles so its
  // fixed-hue (lightness x chroma) plane is always first, matching OKLCH.
  const PLANES = [[0, 1, 2], [2, 1, 0], [2, 0, 1]];

  /** The axis a model treats as its lightness/value axis. */
  function lightAxis(model) {
    const found = model.axes.findIndex((a) => a.role === 'lightness');
    if (found >= 0) return found;
    // A model registered before roles existed: OKLCH-like hues sit at 2,
    // Okhsv/Okhsl hues at 0.
    return model.hueIndex === 2 ? 0 : 2;
  }

  /**
   * Is this model's own light axis a perceptual lightness?
   *
   * `native` models (OKLCH, OKLab, CIELAB L*, CIELCH, HelmGen L, HelmGen LCH) carry
   * their lightness directly in one axis, so that axis value *is* the lightness to
   * guide, lock and print — CIELAB's L* in 0..100, HelmGen's L in 0..1 — and it needs
   * no conversion. The sRGB-referenced picker spaces (OKHSV, OKHSL, OKHWB) do not:
   * their V is a picker coordinate whose pixels at one V have different perceived
   * lightness, so those models guide and lock in OKLab L instead.
   */
  function usesNativeLight(model) {
    if (!model) return false;
    if (model.lightSource) return model.lightSource === 'native';
    return model.id === 'oklch' || model.id === 'oklab'
      || model.id === 'helmgenlch' || model.id === 'helmgen';
  }

  /** The three slices for a model, always fixed-hue / fixed-lightness / fixed-chroma. */
  function planesFor(model) {
    if (model.hueIndex == null) return model.planes || PLANES;
    const h = model.hueIndex;
    const c = model.axes.findIndex((a) => a.role === 'chroma');
    const l = lightAxis(model);
    if (h >= 0 && c >= 0 && l >= 0 && c !== l && c !== h) {
      return [[l, c, h], [h, c, l], [h, l, c]];
    }
    return PLANES;
  }

  /** The exact name of a slice: its two free channels, `horizontal x vertical`. */
  function planeLabel(model, p) {
    const planes = planesFor(model);
    const plane = planes[p] || planes[0];
    return `${model.axes[plane[0]].label} \u00d7 ${model.axes[plane[1]].label}`;
  }

  /** Current axis values for a model, with the store's hue anchor substituted at
   *  zero chroma/saturation (a rectangular value has no hue there). */
  function axesFor(model, store) {
    const axes = model.fromLab(store.lab());
    if (model.hueIndex != null) {
      const achromatic = typeof model.isAchromatic === 'function'
        ? model.isAchromatic(axes)
        : Math.abs(axes[1] - model.axes[1].min) < 1e-9;
      if (achromatic) {
        // The anchor is an OKLCH hue angle, but every model spells its hue axis in
        // its own units (OKHSV's hue, CIELCH's, HelmGen's). Probe the model at a tiny
        // chroma so the pointer lands on the same colour the ring was turned to.
        const probe = model.fromLab(Color.oklchToOklab(store.L, 1e-4, store.H));
        axes[model.hueIndex] = probe[model.hueIndex];
      }
    }
    return axes;
  }

  /** Axis range. `store` lets an absolute-chroma axis reach the working gamut
   *  (OKLCH's C axis is the panel's vertical reach, so it must contain it). */
  function axisRange(model, i, store) {
    const def = model.axes[i];
    if (store && def.absolute && def.role === 'chroma' && typeof store.cmax === 'function') {
      return { min: def.min, max: store.cmax() };
    }
    return { min: def.min, max: def.max };
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
      { key: 'l', label: 'L', min: 0, max: 1, scale: 100, fmt: 0, role: 'lightness' },
      { key: 'c', label: 'C', min: 0, max: 0.4, scale: 1000, fmt: 0, role: 'chroma', absolute: true },
      { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1, role: 'hue' },
    ],
    hueIndex: 2,
    lightSource: 'native',
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
      { key: 'l', label: 'L', min: 0, max: 1, scale: 100, fmt: 0, role: 'lightness' },
      { key: 'a', label: 'a', min: -0.4, max: 0.4, scale: 1, fmt: 3, role: 'chroma' },
      { key: 'b', label: 'b', min: -0.4, max: 0.4, scale: 1, fmt: 3, role: 'chroma' },
    ],
    lightSource: 'native',
    fromLab(lab) {
      return [lab.L, lab.a, lab.b];
    },
    toLab(axes) {
      return { L: axes[0], a: axes[1], b: axes[2] };
    },
  });

  // --- CIELAB / CIELCH — the Lab standard as views over OKLab --------------
  // D65, matching the rest of the app; CIELAB is gamut-independent, so it needs
  // no domain gate. CIELCH is the standard cylindrical form; there is no
  // standard CIELAB-HSL/HSV and this app does not invent one.
  register({
    id: 'cielab',
    name: 'CIELAB',
    family: 'cielab',
    tol: 1e-2,
    axes: [
      { key: 'l', label: 'L*', min: 0, max: 100, scale: 1, fmt: 1, role: 'lightness' },
      { key: 'a', label: 'a*', min: -160, max: 160, scale: 1, fmt: 1, role: 'chroma' },
      { key: 'b', label: 'b*', min: -160, max: 160, scale: 1, fmt: 1, role: 'chroma' },
    ],
    lightSource: 'native',
    fromLab(lab) {
      const v = Color.oklabToLab(lab.L, lab.a, lab.b);
      return [v.L, v.a, v.b];
    },
    toLab(axes) {
      return Color.labToOklab(axes[0], axes[1], axes[2]);
    },
  });

  register({
    id: 'cielch',
    name: 'CIELCH',
    family: 'cielab',
    tol: 1e-2,
    axes: [
      { key: 'l', label: 'L*', min: 0, max: 100, scale: 1, fmt: 1, role: 'lightness' },
      { key: 'c', label: 'C*', min: 0, max: 180, scale: 1, fmt: 1, role: 'chroma' },
      { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1, role: 'hue' },
    ],
    hueIndex: 2,
    lightSource: 'native',
    isAchromatic(axes) { return Math.abs(axes[1]) < 1e-4; },
    fromLab(lab) {
      const v = Color.oklabToLab(lab.L, lab.a, lab.b);
      return [v.L, Math.hypot(v.a, v.b), Color.mod360((Math.atan2(v.b, v.a) * 180) / Math.PI)];
    },
    toLab(axes) {
      const h = (axes[2] * Math.PI) / 180;
      return Color.labToOklab(axes[0], Math.cos(h) * axes[1], Math.sin(h) * axes[1]);
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
    domain: (lab) => (reference.gamut ? true : inSrgb(lab)),
    lightSource: 'oklab',
    axes: [
      { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1, role: 'hue' },
      { key: 's', label: 'S', min: 0, max: 1, scale: 100, fmt: 0, role: 'chroma' },
      { key: 'v', label: 'V', min: 0, max: 1, scale: 100, fmt: 0, role: 'lightness' },
    ],
    fromLab(lab) {
      if (reference.gamut) {
        // Ottosson's Okhsv computed inside the document's cube (or its gamut, for CMYK).
        const v = reference.gamut.oklabToOkhsv(lab.L, lab.a, lab.b);
        return [v.h, clamp01(v.s), clamp01(v.v)];
      }
      const v = Color.oklabToOkhsv(lab.L, lab.a, lab.b);
      return [v.h, v.s, v.v];
    },
    toLab(axes) {
      if (reference.gamut) {
        return reference.gamut.okhsvToOklab(axes[0], clamp01(axes[1]), clamp01(axes[2]));
      }
      return Color.okhsvToOklab(axes[0], axes[1], axes[2]);
    },
  });

  register({
    id: 'okhsl',
    name: 'OKHSL',
    hueIndex: 0,
    dense: true,
    domain: (lab) => (reference.gamut ? true : inSrgb(lab)),
    lightSource: 'oklab',
    axes: [
      { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1, role: 'hue' },
      { key: 's', label: 'S', min: 0, max: 1, scale: 100, fmt: 0, role: 'chroma' },
      { key: 'l', label: 'L', min: 0, max: 1, scale: 100, fmt: 0, role: 'lightness' },
    ],
    fromLab(lab) {
      if (reference.gamut) {
        const v = reference.gamut.oklabToOkhsl(lab.L, lab.a, lab.b);
        return [v.h, clamp01(v.s), clamp01(v.l)];
      }
      const v = Color.oklabToOkhsl(lab.L, lab.a, lab.b);
      return [v.h, v.s, v.l];
    },
    toLab(axes) {
      if (reference.gamut) {
        return reference.gamut.okhslToOklab(axes[0], clamp01(axes[1]), clamp01(axes[2]));
      }
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
    domain: (lab) => (reference.gamut ? true : inSrgb(lab)),
    lightSource: 'oklab',
    isAchromatic(axes) {
      return Math.abs(axes[1] - (1 - axes[2])) < 1e-6;
    },
    axes: [
      { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1, role: 'hue' },
      { key: 'w', label: 'W', min: 0, max: 1, scale: 100, fmt: 0, role: 'chroma' },
      { key: 'b', label: 'B', min: 0, max: 1, scale: 100, fmt: 0, role: 'lightness' },
    ],
    fromLab(lab) {
      if (reference.gamut) {
        const v = reference.gamut.oklabToOkhwb(lab.L, lab.a, lab.b);
        return [v.h, clamp01(v.w), clamp01(v.b)];
      }
      const v = Color.oklabToOkhwb(lab.L, lab.a, lab.b);
      return [v.h, v.w, v.b];
    },
    toLab(axes) {
      if (reference.gamut) {
        return reference.gamut.okhwbToOklab(axes[0], clamp01(axes[1]), clamp01(axes[2]));
      }
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
      lightSource: 'native',
      axes: [
        { key: 'l', label: 'L', min: 0, max: 1, scale: 100, fmt: 0, role: 'lightness' },
        { key: 'c', label: 'C', min: 0, max: 0.65, scale: 1000, fmt: 0, role: 'chroma' },
        { key: 'h', label: 'H', min: 0, max: 360, scale: 1, fmt: 1, role: 'hue' },
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
      lightSource: 'native',
      axes: [
        { key: 'l', label: 'L', min: 0, max: 1, scale: 100, fmt: 0, role: 'lightness' },
        { key: 'a', label: 'a', min: -0.45, max: 0.45, scale: 1, fmt: 3, role: 'chroma' },
        { key: 'b', label: 'b', min: -0.6, max: 0.6, scale: 1, fmt: 3, role: 'chroma' },
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

  return {
    register, get, list, ids, has, DEFAULT_ID,
    FAMILY_IDS, normalizeFamily, families, familyOf, inFamily, listForFamily, defaultForFamily,
    PLANES, planesFor, planeLabel, lightAxis, usesNativeLight,
    setReference, referenceLimited,
    axesFor, axisRange, formatAxis,
  };
});

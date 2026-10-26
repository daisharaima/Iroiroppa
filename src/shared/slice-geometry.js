/*
 * Slice geometry — the pure bridge between a 2D slice and the model axes.
 *
 * A slice has three axes: horizontal `u`, vertical `v` (both 0..1) and one
 * fixed axis. The raster and the pointer MUST use the same mapping, or a pick
 * lands beside the colour it is over; this module is that one mapping, plus the
 * small pieces the pickers share: the reachability predicate, the crosshair
 * clamp, the iso-lightness guide line and the Shift-lock override.
 *
 * Loads as CommonJS in Node and as a global `IroSliceGeometry` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./color-models'), require('./color'));
  } else {
    root.IroSliceGeometry = factory(root.IroColorModels, root.Color);
  }
})(typeof self !== 'undefined' ? self : this, function (Models, Color) {
  'use strict';

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp01 = (x) => clamp(x, 0, 1);

  /** Axis range, letting an absolute-chroma axis reach the working gamut. */
  function range(model, i, store) {
    const def = model.axes[i];
    if (store && def.absolute && def.role === 'chroma' && typeof store.cmax === 'function') {
      return { min: def.min, max: store.cmax() };
    }
    return { min: def.min, max: def.max };
  }

  /** The [horizontal, vertical, fixed] axes of a plane, model-aware. */
  function planeOf(model, plane) {
    const planes = Models.planesFor(model);
    return planes[plane] || planes[0];
  }

  /** The model's axes for a unit (u,v) point, keeping the fixed axis from `fixed`. */
  function pickAxes(model, plane, u, v, fixed, store) {
    const [hi, vi, fi] = planeOf(model, plane);
    const hr = range(model, hi, store);
    const vr = range(model, vi, store);
    const out = Array.isArray(fixed) ? fixed.slice() : [0, 0, 0];
    out[hi] = hr.min + clamp01(u) * (hr.max - hr.min);
    out[vi] = vr.min + clamp01(v) * (vr.max - vr.min);
    if (!Array.isArray(fixed) || !Number.isFinite(out[fi])) {
      out[fi] = (model.axes[fi].min + model.axes[fi].max) / 2;
    }
    return out;
  }

  /** The unit (u,v) of an axes triple, using the same ranges as pickAxes. */
  function pointOf(model, plane, axes, store) {
    const [hi, vi] = planeOf(model, plane);
    const hr = range(model, hi, store);
    const vr = range(model, vi, store);
    const u = (axes[hi] - hr.min) / (hr.max - hr.min);
    const v = (axes[vi] - vr.min) / (vr.max - vr.min);
    return { u, v };
  }

  /** Clamp every axis into its range; reports whether the value had to move. */
  function clampAxes(model, axes, store) {
    let clamped = false;
    const out = (Array.isArray(axes) ? axes : [0, 0, 0]).slice();
    for (let i = 0; i < 3; i += 1) {
      const r = range(model, i, store);
      if (!Number.isFinite(out[i])) {
        out[i] = (r.min + r.max) / 2;
        clamped = true;
      } else if (out[i] < r.min) {
        out[i] = r.min;
        clamped = true;
      } else if (out[i] > r.max) {
        out[i] = r.max;
        clamped = true;
      }
    }
    return { axes: out, clamped };
  }

  /**
   * Is this axes triple on the slice *and* in the working gamut? This is the
   * one predicate the raster (shown) and the pick (reachable) both use; a model
   * never decides displayability, only the gamut does.
   */
  function inside(model, axes, store) {
    if (typeof model.inGamut === 'function') return model.inGamut(axes);
    if (!store) return true;
    const lab = model.toLab(axes);
    const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
    return store.inGamut(lch.L, lch.C, lch.H);
  }

  /** Pixel-border-corrected pointer position inside a canvas, as 0..1. */
  function contentPoint(metrics, clientX, clientY) {
    const w = metrics.clientWidth || metrics.width || 0;
    const h = metrics.clientHeight || metrics.height || 0;
    if (!(w > 0) || !(h > 0)) return { x: 0, y: 0 };
    return {
      x: clamp01((clientX - metrics.left - (metrics.clientLeft || 0)) / w),
      y: clamp01((clientY - metrics.top - (metrics.clientTop || 0)) / h),
    };
  }

  /**
   * The iso-lightness line through the selected colour, in slice coordinates.
   * `light` is the model's own light-axis value. Returns null when the plane
   * holds the light axis fixed (the whole panel is one lightness).
   */
  function guideLine(model, plane, light, store) {
    const li = Models.lightAxis(model);
    const [hi, vi, fi] = planeOf(model, plane);
    if (fi === li || (hi !== li && vi !== li)) return null;
    const r = range(model, li, store);
    const t = clamp01((light - r.min) / (r.max - r.min));
    if (hi === li) return { u0: t, v0: 0, u1: t, v1: 1 };
    return { u0: 0, v0: t, u1: 1, v1: t };
  }

  /** Override the model's light axis: what a Shift-locked drag does. */
  function lockAxes(model, axes, light) {
    const out = axes.slice();
    out[Models.lightAxis(model)] = light;
    return out;
  }

  /** Does the model's own light axis directly carry its guide lightness? */
  function lightAxisIsCanonical(model) {
    return Models.usesNativeLight(model);
  }

  /** The value a guide/lock targets, in the model's native lightness units. */
  function lightnessOf(model, axes) {
    if (lightAxisIsCanonical(model)) return axes[Models.lightAxis(model)];
    return model.toLab(axes).L;
  }

  /** Native-light comparison tolerance, in the model's own light-axis units. */
  function lightnessTolerance(model) {
    const r = range(model, Models.lightAxis(model));
    return Math.max(1e-6, Math.abs(r.max - r.min) * 1e-4);
  }

  /**
   * Solve one axis for a target lightness. Most axes are monotone over the
   * model's range; the endpoint bracket finds the root directly, and a coarse
   * scan is the fallback for a non-monotone axis (chroma in a fixed-light slice).
   */
  function solveAxis(model, axes, index, target, store) {
    const r = range(model, index, store);
    const at = (x) => {
      const a = axes.slice();
      a[index] = x;
      return lightnessOf(model, a);
    };
    if (!Number.isFinite(target)) return axes[index];
    if (lightAxisIsCanonical(model) && index === Models.lightAxis(model)) {
      return clamp(target, r.min, r.max);
    }
    const lo = r.min;
    const hi = r.max;
    const flo = at(lo);
    const fhi = at(hi);
    if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return axes[index];
    if (flo === target) return lo;
    if (fhi === target) return hi;
    if ((flo - target) * (fhi - target) < 0) {
      let a = lo;
      let b = hi;
      for (let i = 0; i < 20; i += 1) {
        const m = (a + b) / 2;
        const fm = at(m);
        if (fm === target) return m;
        if ((flo - target) * (fm - target) <= 0) b = m;
        else a = m;
      }
      return (a + b) / 2;
    }
    // No endpoint bracket: sample, then bisect the bracket nearest the target.
    const N = 24;
    let best = lo;
    let bestD = Math.abs(flo - target);
    let bracket = null;
    let prevX = lo;
    let prevF = flo - target;
    for (let i = 1; i <= N; i += 1) {
      const x = lo + ((hi - lo) * i) / N;
      const f = at(x) - target;
      const d = Math.abs(f);
      if (d < bestD) { bestD = d; best = x; }
      if (!bracket && prevF * f <= 0) bracket = [prevX, x];
      prevX = x;
      prevF = f;
    }
    if (bracket) {
      let a = bracket[0];
      let b = bracket[1];
      const fa = at(a) - target;
      for (let i = 0; i < 20; i += 1) {
        const m = (a + b) / 2;
        const fm = at(m) - target;
        if (fm === 0) return m;
        if (fa * fm <= 0) b = m;
        else a = m;
      }
      return (a + b) / 2;
    }
    return best;
  }

  /** Solve an axis and report whether the native-light target was actually reached. */
  function solveAxisResult(model, axes, index, target, store) {
    const value = solveAxis(model, axes, index, target, store);
    const a = axes.slice();
    a[index] = value;
    const residual = Math.abs(lightnessOf(model, a) - target);
    return {
      value,
      residual,
      ok: Number.isFinite(residual) && residual <= lightnessTolerance(model),
    };
  }

  /** Does this value actually sit on the requested native-light contour? */
  function lightnessReached(model, axes, target) {
    return Math.abs(lightnessOf(model, axes) - target) <= lightnessTolerance(model);
  }

  /** Hold the model's native lightness by solving its light axis. */
  function setLightness(model, axes, target, store) {
    const li = Models.lightAxis(model);
    const out = axes.slice();
    const r = range(model, li, store);
    if (lightAxisIsCanonical(model)) {
      out[li] = clamp(target, r.min, r.max);
      return out;
    }
    out[li] = solveAxis(model, out, li, target, store);
    return out;
  }

  /**
   * Hold the chosen lightness inside one plane. A free light axis is solved; in a
   * fixed-light plane the vertical free axis is solved instead, so the press is
   * projected onto the iso-lightness contour without moving the plane (or its
   * raster).
   */
  function applyLightness(model, plane, axes, target, store) {
    const li = Models.lightAxis(model);
    if (plane == null) return setLightness(model, axes, target, store);
    const [hi, vi, fi] = planeOf(model, plane);
    const out = axes.slice();
    if (li === hi || li === vi) return setLightness(model, out, target, store);
    if (li === fi) {
      if (lightAxisIsCanonical(model)) return out;
      out[vi] = solveAxis(model, out, vi, target, store);
      return out;
    }
    return out;
  }

  /**
   * The iso-lightness contour in a plane, as normalized (u,v) points plus the
   * reachability flags. `target` is in the selected lightness source's units.
   * Returns null when the whole plane is one value of that source.
   */
  function guideCurve(model, plane, target, axes, store, N = 48) {
    const li = Models.lightAxis(model);
    const [hi, vi, fi] = planeOf(model, plane);
    if (!Number.isFinite(target)) return null;
    if (li === fi && lightAxisIsCanonical(model)) return null;
    let paramAxis;
    let adjustAxis;
    if (li === hi) { paramAxis = vi; adjustAxis = li; }
    else if (li === vi) { paramAxis = hi; adjustAxis = li; }
    else if (li === fi) { paramAxis = hi; adjustAxis = vi; }
    else return null;
    const pr = range(model, paramAxis, store);
    const points = [];
    const flags = [];
    for (let i = 0; i <= N; i += 1) {
      const a = axes.slice();
      a[paramAxis] = pr.min + ((pr.max - pr.min) * i) / N;
      const solved = solveAxisResult(model, a, adjustAxis, target, store);
      a[adjustAxis] = solved.value;
      const p = pointOf(model, plane, a, store);
      points.push({ u: p.u, v: p.v });
      // A clamped endpoint is not a point on this lightness contour: do not
      // draw it as a flat line along the panel edge.
      flags.push(solved.ok && inside(model, a, store));
    }
    return { points, flags };
  }

  /** Contiguous true runs of a sampled predicate, as [start, end] index pairs. */
  function runs(flags) {
    const out = [];
    let start = -1;
    for (let i = 0; i < flags.length; i += 1) {
      if (flags[i] && start < 0) start = i;
      else if (!flags[i] && start >= 0) { out.push([start, i - 1]); start = -1; }
    }
    if (start >= 0) out.push([start, flags.length - 1]);
    return out;
  }

  return {
    range, planeOf, pickAxes, pointOf, clampAxes, inside, contentPoint,
    guideLine, lockAxes, runs,
    lightAxisIsCanonical, lightnessOf, lightnessTolerance, lightnessReached,
    solveAxis, solveAxisResult, setLightness, applyLightness, guideCurve,
  };
});

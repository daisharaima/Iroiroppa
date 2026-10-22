/*
 * Per-slice display orientation: rotate by quarter turns and/or flip a finished
 * slice plot. This is a *display* transform only: the colour maths and the plot
 * generation stay canonical, and picking applies the inverse before the existing
 * axis mapping, so what is under the pointer is what gets picked.
 *
 * Normalized coordinates: (0,0) is top-left. A positive rotation is clockwise.
 * Flips are applied after the rotation, in display space.
 *
 * Loads as CommonJS in Node and as a global `IroSliceView` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroSliceView = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function normRotate(value) {
    const n = ((Number(value) || 0) % 360 + 360) % 360;
    if (n === 90 || n === 180 || n === 270) return n;
    return 0;
  }

  function composeView(rotate, flipH, flipV) {
    return { rotate: normRotate(rotate), flipH: Boolean(flipH), flipV: Boolean(flipV) };
  }

  /** Canonical (u,v) -> display (x,y). */
  function forward(view, u, v) {
    const w = composeView(view && view.rotate, view && view.flipH, view && view.flipV);
    let x = u;
    let y = v;
    if (w.rotate === 90) { x = 1 - v; y = u; }
    else if (w.rotate === 180) { x = 1 - u; y = 1 - v; }
    else if (w.rotate === 270) { x = v; y = 1 - u; }
    if (w.flipH) x = 1 - x;
    if (w.flipV) y = 1 - y;
    return { u: x, v: y };
  }

  /** Display (x,y) -> canonical (u,v); the exact inverse of forward(). */
  function inverse(view, x, y) {
    const w = composeView(view && view.rotate, view && view.flipH, view && view.flipV);
    let dx = x;
    let dy = y;
    if (w.flipH) dx = 1 - dx;
    if (w.flipV) dy = 1 - dy;
    if (w.rotate === 90) return { u: dy, v: 1 - dx };
    if (w.rotate === 180) return { u: 1 - dx, v: 1 - dy };
    if (w.rotate === 270) return { u: 1 - dy, v: dx };
    return { u: dx, v: dy };
  }

  /** True for the identity view (no rotation, no flips). */
  function isIdentity(view) {
    const w = composeView(view && view.rotate, view && view.flipH, view && view.flipV);
    return w.rotate === 0 && !w.flipH && !w.flipV;
  }

  return { composeView, forward, inverse, isIdentity };
});

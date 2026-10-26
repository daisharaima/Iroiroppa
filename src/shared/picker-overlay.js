/*
 * Pointer and lightness-guide overlay art for the canvas pickers.
 *
 * The Slices, Wheel and Disc all paint a small local pointer and one clipped
 * guide polyline. Keeping the strokes in one place is what stops the three
 * modules drifting: a "disappeared crosshair" was one module's 5.5 px ring
 * against another's larger marker. The pointer is a quiet ring; the full
 * crosshair (Slices only) and the single lightness guide are separate, thin
 * overlay lines, so none can be mistaken for another.
 *
 * Loads as CommonJS in Node and as a global `IroPickerOverlay` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroPickerOverlay = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GUIDE = 'rgba(255,255,255,0.78)';
  const GUIDE_LOCKED = 'rgba(232,64,64,0.9)';
  const HALO = 'rgba(0,0,0,0.32)';

  /** A quiet local pointer: one small ring, no arms and no centre dot. `scale`
   *  is canvas device pixels per CSS pixel, so it keeps the same visual size. */
  function pointer(c2d, x, y, opts) {
    const o = opts || {};
    const s = o.scale || 1;
    const r = (v) => v * s;
    c2d.save();
    // A soft white edge keeps the thin dark ring legible on dark maps.
    c2d.beginPath(); c2d.arc(x, y, r(4.5), 0, Math.PI * 2);
    c2d.lineWidth = r(2.6); c2d.strokeStyle = 'rgba(255,255,255,0.55)'; c2d.stroke();
    c2d.beginPath(); c2d.arc(x, y, r(4.5), 0, Math.PI * 2);
    c2d.lineWidth = r(1.15); c2d.strokeStyle = 'rgba(0,0,0,0.78)'; c2d.stroke();
    if (o.clamped) {
      c2d.beginPath();
      c2d.setLineDash([r(2.5), r(2.5)]);
      c2d.arc(x, y, r(7.2), 0, Math.PI * 2);
      c2d.lineWidth = r(1.4); c2d.strokeStyle = 'rgba(0,0,0,0.45)'; c2d.stroke();
      c2d.beginPath();
      c2d.arc(x, y, r(7.2), 0, Math.PI * 2);
      c2d.lineWidth = r(0.9); c2d.strokeStyle = 'rgba(255,255,255,0.8)'; c2d.stroke();
      c2d.setLineDash([]);
    }
    c2d.restore();
  }

  /** The old full crosshair: vertical + horizontal hairlines across the slice. */
  function crosshair(c2d, w, h, x, y, opts) {
    const o = opts || {};
    const s = o.scale || 1;
    c2d.save();
    c2d.beginPath();
    c2d.moveTo(x, 0); c2d.lineTo(x, h);
    c2d.moveTo(0, y); c2d.lineTo(w, y);
    c2d.lineWidth = 1.5 * s;
    c2d.strokeStyle = 'rgba(0,0,0,0.42)';
    c2d.stroke();
    c2d.beginPath();
    c2d.moveTo(x, 0); c2d.lineTo(x, h);
    c2d.moveTo(0, y); c2d.lineTo(w, y);
    c2d.lineWidth = 1 * s;
    c2d.strokeStyle = 'rgba(255,255,255,0.8)';
    c2d.stroke();
    c2d.restore();
  }

  /** One or more clipped guide polylines; thin enough to read as the old line. */
  function guide(c2d, segments, opts) {
    const o = opts || {};
    const s = o.scale || 1;
    const color = o.locked ? GUIDE_LOCKED : GUIDE;
    c2d.save();
    c2d.globalAlpha = o.alpha == null ? 1 : o.alpha;
    for (const pts of segments || []) {
      if (!pts || pts.length < 2) continue;
      c2d.beginPath();
      c2d.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i += 1) c2d.lineTo(pts[i][0], pts[i][1]);
      c2d.lineWidth = 2 * s; c2d.strokeStyle = HALO; c2d.stroke();
      c2d.lineWidth = 1.3 * s; c2d.strokeStyle = color; c2d.stroke();
    }
    c2d.restore();
  }

  return { pointer, crosshair, guide, GUIDE, GUIDE_LOCKED };
});

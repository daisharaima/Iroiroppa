/*
 * Interactive render cadence — which panel a gesture rebuilds this frame.
 *
 * While a gesture is in flight (a local drag or a sibling palette's preview stream)
 * the Slices rebuild at most one panel per frame. The budget has to come from the
 * *interactive* build (a native-pixel raster), never from the trailing full-quality
 * rebuild: a 30-45 ms dpr-2 plane would otherwise mark the model "expensive" and
 * freeze every map for the whole next gesture, leaving only the guide moving.
 *
 * Pure and injected so it is unit-tested without a DOM or a display.
 *
 * Loads as CommonJS in Node and as a global `IroRenderCadence` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroRenderCadence = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * How long to wait before the next interactive build, given the last one's cost.
   * A build that fits in a frame waits nothing; a heavy one is spaced out, never
   * more than `maxHold` ms (the pointer, crosshair and guide always stay live).
   */
  function holdFor(lastMs, budget = 14, maxHold = 200) {
    const ms = Number.isFinite(lastMs) && lastMs > 0 ? lastMs : 0;
    return Math.max(0, Math.min(maxHold, ms - budget));
  }

  /**
   * Pick the panel to rebuild now, or -1 to hold the maps this frame.
   * @returns {{panel: number, cursor: number}}
   */
  function pickPanel({ visible, cursor = 0, now = 0, holdUntil = 0 } = {}) {
    if (!Array.isArray(visible) || !visible.length) return { panel: -1, cursor: cursor || 0 };
    if (now < holdUntil) return { panel: -1, cursor };
    const i = Math.max(0, Math.floor(cursor) || 0) % visible.length;
    return { panel: visible[i], cursor: (i + 1) % visible.length };
  }

  return { holdFor, pickPanel };
});

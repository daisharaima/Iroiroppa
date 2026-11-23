
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

  /**
   * Pick *every* panel that can rebuild inside this frame's budget, in round-robin
   * order. For a cheap plane (the analytic OKLCH slices, ~3-4 ms) that is all of them, so
   * every map moves with the pointer instead of stepping once every two or three
   * frames. For an expensive one the list falls back to what used to happen anyway:
   * one panel per frame, rotating.
   *
   * The panel at the cursor is always taken, even when it alone is over budget — a map
   * must never stop moving, and a panel that is skipped every frame would look frozen.
   * The cursor advances by one either way, so every panel is first within `visible.length`
   * frames.
   *
   * @param {{visible: number[], cursor?: number, costs?: number[], budget?: number,
   *          now?: number, holdUntil?: number}} opts
   *   `costs[p]` is the last measured *interactive* build cost of that panel, in ms.
   * @returns {{panels: number[], cursor: number}}
   */
  function choosePanels({ visible, cursor = 0, costs = [], budget = 8, now = 0, holdUntil = 0 } = {}) {
    if (!Array.isArray(visible) || !visible.length) return { panels: [], cursor: cursor || 0 };
    if (now < holdUntil) return { panels: [], cursor };
    const n = visible.length;
    const start = Math.max(0, Math.floor(cursor) || 0) % n;
    const panels = [];
    let spent = 0;
    for (let i = 0; i < n; i += 1) {
      const p = visible[(start + i) % n];
      const cost = Number.isFinite(costs[p]) && costs[p] > 0 ? costs[p] : 0;
      if (panels.length && spent + cost > budget) continue;
      panels.push(p);
      spent += cost;
    }
    return { panels, cursor: (start + 1) % n };
  }

  return { holdFor, pickPanel, choosePanels };
});

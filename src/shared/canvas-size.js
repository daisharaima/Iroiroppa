/*
 * Backing-store scale for the picker canvases.
 *
 * The maps used to render at a fixed 2× (device-pixel supersampling). That is fine for a
 * small module but the cost grows with the *area*: a module stretched to fill the palette
 * renders 4× the pixels of its usual size and drops frames ("the bigger I make it, the
 * laggier it gets"). A fixed dpr is the wrong knob — a pixel *budget* is. The scale never
 * goes below 1 (never upscale a smaller buffer into a blurry one), and above the budget
 * only the supersampling is given up, which is invisible at normal viewing distance.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroCanvasSize = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const IDLE_BUDGET = 130000; // ~360×360 at 1× — a little supersampling only when small
  const LIVE_BUDGET = 55000; // while the pointer is down: resolution follows speed

  /**
   * @param {number} cssW  layout width (CSS px)
   * @param {number} cssH  layout height (CSS px)
   * @param {{want?: number, budget?: number, minScale?: number}} [opts]
   *   `want` is the scale the module would like (its supersampling rule); the budget caps
   *   it, `minScale` floors it (1 by default, so a buffer is never upscaled).
   * @returns {number} the scale to multiply CSS pixels by
   */
  function backingScale(cssW, cssH, opts = {}) {
    const area = Math.max(1, (Number(cssW) || 1) * (Number(cssH) || 1));
    const want = Number(opts.want) > 0 ? Number(opts.want) : 2;
    const minScale = Number(opts.minScale) > 0 ? Number(opts.minScale) : 1;
    const budget = Number(opts.budget) > 0 ? Number(opts.budget) : IDLE_BUDGET;
    const fit = Math.sqrt(budget / area);
    return Math.max(minScale, Math.min(want, fit));
  }

  return { backingScale, IDLE_BUDGET, LIVE_BUDGET };
});

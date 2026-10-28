/*
 * Cursor-relative placement for a revealed palette.
 *
 * Pure and shared: main positions a window, the tests check the geometry. The
 * directional modes place the window on that side of the pointer (so "top-left"
 * means above and left of it) with an 8 px gap between the nearest corner and the
 * cursor. "center" centers the window on the cursor; "keep" means do not move.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroShortcutPosition = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GAP = 8;
  const EDGE = 4;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  /**
   * @param {{mode?: string, cursor?: {x:number,y:number}, size?: {width:number,height:number},
   *          area?: {x:number,y:number,width:number,height:number}, gap?: number}} opts
   * @returns {{x:number,y:number}|null} null for keep / unusable input
   */
  function positionBox(opts = {}) {
    const mode = String(opts.mode || 'keep');
    if (mode === 'keep') return null;
    const cursor = opts.cursor || { x: 0, y: 0 };
    const size = opts.size || { width: 1, height: 1 };
    const area = opts.area || { x: 0, y: 0, width: 1920, height: 1080 };
    const gap = Number.isFinite(opts.gap) ? Math.max(0, opts.gap) : GAP;
    const w = Math.max(1, Number(size.width) || 1);
    const h = Math.max(1, Number(size.height) || 1);
    let x;
    let y;
    if (mode === 'center') {
      x = cursor.x - w / 2;
      y = cursor.y - h / 2;
    } else if (mode === 'top-left') {
      x = cursor.x - gap - w;
      y = cursor.y - gap - h;
    } else if (mode === 'top-right') {
      x = cursor.x + gap;
      y = cursor.y - gap - h;
    } else if (mode === 'bottom-left') {
      x = cursor.x - gap - w;
      y = cursor.y + gap;
    } else if (mode === 'bottom-right') {
      x = cursor.x + gap;
      y = cursor.y + gap;
    } else {
      return null;
    }
    return {
      x: Math.round(clamp(x, area.x + EDGE, area.x + area.width - w - EDGE)),
      y: Math.round(clamp(y, area.y + EDGE, area.y + area.height - h - EDGE)),
    };
  }

  return { positionBox, GAP, EDGE };
});

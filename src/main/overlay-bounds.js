'use strict';

const CAP = 16384;

/**
 * @param {Array<{bounds?: {x:number,y:number,width:number,height:number},
 *                workArea?: {x:number,y:number,width:number,height:number}}>} displays
 * @param {{inset?: number, cap?: number}} [opts]
 * @returns {{x:number, y:number, width:number, height:number}}
 */
function overlayBounds(displays, opts = {}) {
  const list = Array.isArray(displays) ? displays.filter(Boolean) : [];
  const inset = Number.isFinite(opts.inset) ? Math.max(0, opts.inset) : 1;
  const cap = Number.isFinite(opts.cap) ? opts.cap : CAP;

  const areas = list.map((d) => d.workArea || d.bounds).filter((a) => a
    && Number.isFinite(a.x) && Number.isFinite(a.y)
    && Number.isFinite(a.width) && Number.isFinite(a.height));
  if (!areas.length) return { x: 0, y: 0, width: Math.min(cap, 320), height: Math.min(cap, 240) };
  const minX = Math.min(...areas.map((a) => a.x)) + inset;
  const minY = Math.min(...areas.map((a) => a.y)) + inset;
  const maxX = Math.max(...areas.map((a) => a.x + a.width)) - inset;
  const maxY = Math.max(...areas.map((a) => a.y + a.height)) - inset;
  return {
    x: Math.max(-cap, minX),
    y: Math.max(-cap, minY),
    width: Math.min(cap, Math.max(1, Math.round(maxX - minX))),
    height: Math.min(cap, Math.max(1, Math.round(maxY - minY))),
  };
}

module.exports = { overlayBounds, CAP };

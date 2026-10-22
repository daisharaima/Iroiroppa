'use strict';

// Where the drag overlay lives.
//
// The overlay is one transparent, always-on-top window that carries the drag chip and
// the drop indicator above every palette (docs/LAYOUT.md, V4). It must **not** cover a
// whole display: Windows 11 turns Do Not Disturb on when it sees a full-screen app (the
// "When using an app in full-screen mode" automatic rule), and a desktop-sized surface
// was enough to trigger it on a palette drag. So the surface is the union of the
// displays' *work areas* — never the taskbar — inset by a pixel so no monitor is covered
// edge to edge.
//
// Pure: takes the display records Electron reports (`{ bounds, workArea }`), so the
// geometry is unit-testable without a display.

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
  // The work area is the display minus the taskbar. Fall back to `bounds` only for a
  // display record that has no work area at all.
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

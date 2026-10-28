'use strict';

// Geometry for the overlay's merge warning. Like overlay-menu-box.js this is
// pure and injected (display record + anchor), so the small-screen and
// multi-monitor cases can be tested without Electron.

const INSET = 6;
const WIDTH = 330;
const MIN_HEIGHT = 132;
const MAX_HEIGHT = 240;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Rough wrapped-line count for the fixed card width (CSS px, 11–12 px text). */
function lines(text, charsPerLine, max) {
  const value = String(text || '');
  if (!value) return 0;
  const wanted = Math.max(1, Math.ceil(value.length / charsPerLine));
  return Math.min(wanted, max);
}

/**
 * @param {{anchor?: {x:number,y:number}, area: {x:number,y:number,width:number,height:number},
 *          title?: string, message?: string, detail?: string}} opts
 * @returns {{x:number,y:number,width:number,height:number}}
 */
function confirmBox(opts = {}) {
  const area = opts.area || { x: 0, y: 0, width: 1920, height: 1080 };
  const anchor = opts.anchor || { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const width = Math.min(Math.max(1, area.width - INSET * 2), WIDTH);
  // 16 padding top + 18 title + 16 per message line + 13 per detail line +
  // 34 button row + 14 padding bottom.
  const height = Math.round(clamp(
    16 + 18 + lines(opts.message, 40, 4) * 16 + lines(opts.detail, 46, 3) * 13 + 34 + 14,
    MIN_HEIGHT, MAX_HEIGHT,
  ));
  const x = Math.round(clamp(
    (Number.isFinite(anchor.x) ? anchor.x : area.x + area.width / 2) - width / 2,
    area.x + INSET, area.x + area.width - width - INSET,
  ));
  const y = Math.round(clamp(
    (Number.isFinite(anchor.y) ? anchor.y : area.y + area.height / 2) + 18,
    area.y + INSET, area.y + area.height - height - INSET,
  ));
  return { x, y, width, height };
}

module.exports = { confirmBox, WIDTH, MIN_HEIGHT, MAX_HEIGHT };

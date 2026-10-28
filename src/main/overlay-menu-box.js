'use strict';

// Geometry for the overlay menu (the profile picker and the palette menu).
//
// The menu is its own always-on-top window: main sizes it to the menu, so the
// only thing that has to be right is the box. Pure and injected, like
// overlay-bounds.js, so the 1/10/200-row cases are testable without a display.
//
// A menu shows at most `maxRows` rows and scrolls the rest. The old code sized
// for every item and let the column flexbox shrink the rows instead, which cut
// every line of a long profile list in half (the report). Both halves are fixed
// here: the height is a fixed row count, and the menu CSS refuses to shrink.

const ROW_H = 24;
const PADDING = 8;
const BORDER = 2;
const GAP = 1;
const INSET = 4;
const MIN_WIDTH = 132;
const MAX_WIDTH = 360;
const MIN_HEIGHT = 80;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * @param {{items?: Array<{label?: string}>, anchor?: {x:number,y:number},
 *          area: {x:number,y:number,width:number,height:number},
 *          maxRows?: number, maxHeight?: number, width?: number,
 *          rowHeight?: number, padding?: number}} opts
 * @returns {{x:number,y:number,width:number,height:number,visibleRows:number,scrolls:boolean}}
 */
function menuBox(opts = {}) {
  const items = Array.isArray(opts.items) ? opts.items : [];
  const area = opts.area || { x: 0, y: 0, width: 1920, height: 1080 };
  const anchor = opts.anchor || { x: area.x, y: area.y };
  const ax = Number.isFinite(anchor.x) ? anchor.x : area.x + INSET;
  const ay = Number.isFinite(anchor.y) ? anchor.y : area.y + INSET;
  const rowHeight = Number.isFinite(opts.rowHeight) ? opts.rowHeight : ROW_H;
  const padding = Number.isFinite(opts.padding) ? opts.padding : PADDING;
  const maxRows = Number.isFinite(opts.maxRows) ? Math.max(1, opts.maxRows) : 10;

  const longest = items.reduce((n, item) => Math.max(n, String(item.label || '').length), 7);
  const wantedWidth = Number.isFinite(opts.width) ? opts.width : longest * 7 + 26;
  const width = Math.round(clamp(wantedWidth, MIN_WIDTH, MAX_WIDTH));

  // Action, heading and separator rows have their own heights; a separator or a
  // heading is not a row and must not consume one of the ten visible-row slots.
  const heightOf = (item) => {
    if (item && item.kind === 'separator') return 9;
    if (item && item.kind === 'heading') return Math.round(rowHeight * 0.72);
    if (item && item.kind === 'action') return Math.max(rowHeight, 30);
    return rowHeight;
  };
  const normalRows = items.filter((item) => !item || (item.kind !== 'separator' && item.kind !== 'heading')).length;
  // Headings are not rows either, but their height must count, or the cap hides them
  // and the menu can never show every family.
  const extras = items.reduce((n, item) => n
    + (item && item.kind === 'heading' ? heightOf(item) : Math.max(0, heightOf(item) - rowHeight)), 0);
  const gap = GAP * Math.max(0, items.length - 1);
  const natural = items.reduce((n, item) => n + heightOf(item), 0) + padding + BORDER + gap;
  const visibleRows = Math.max(1, Math.min(normalRows || 1, maxRows));
  const rowHeightCap = visibleRows * rowHeight + padding + BORDER
    + extras + GAP * Math.max(0, visibleRows - 1);
  const areaCap = Number.isFinite(opts.maxHeight) ? opts.maxHeight : Math.round(area.height * 0.7);
  const height = Math.round(clamp(Math.min(natural, rowHeightCap), MIN_HEIGHT, Math.max(MIN_HEIGHT, areaCap)));

  const x = Math.round(clamp(ax, area.x + INSET, area.x + area.width - width - INSET));
  const y = Math.round(clamp(ay, area.y + INSET, area.y + area.height - height - INSET));

  return { x, y, width, height, visibleRows, scrolls: natural > height };
}

module.exports = { menuBox, ROW_H, PADDING, MIN_WIDTH, MAX_WIDTH };

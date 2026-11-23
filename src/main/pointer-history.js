'use strict';

/**
 * @param {object} opts
 * @param {() => Promise<object|null>} opts.readColor a fresh Companion read
 * @param {(rgb: {r:number,g:number,b:number}) => void} opts.commit
 * @param {() => boolean} [opts.hasPending] is a host pick awaiting its up?
 */
function createPointerHistory({ readColor, commit, hasPending = () => true }) {
  let busy = false;
  return async function onPointerUp() {
    if (busy || !hasPending()) return;
    busy = true;
    try {
      const color = await readColor();
      if (!color || color.transparent) return;
      const rgb = activeRgb(color);
      if (rgb) commit(rgb);
    } catch {

    } finally {
      busy = false;
    }
  };
}

/**
 * Gate ON: record the colour used by a canvas contact.
 *
 * @param {object} opts
 * @param {() => boolean} opts.isOn
 * @param {() => Promise<object|null>} opts.readColor
 * @param {(rgb: {r:number,g:number,b:number}) => void} opts.commit
 * @param {() => ({r:number,g:number,b:number}|null)} [opts.pending]
 * @param {() => ({r:number,g:number,b:number}|null)} [opts.head]
 * @param {() => void} [opts.drop] clear a pending colour (transparent contact)
 */
function createContactHistory({
  isOn, readColor, commit, pending = () => null, head = () => null, drop = () => {},
}) {
  let busy = false;
  return async function onPointerDown(info) {
    if (busy || !isOn()) return;
    if (!info || info.canvas !== true || info.alt === true) return;
    busy = true;
    try {
      const pendingRgb = pending();
      let rgb = null;
      let transparent = false;
      try {
        const color = await readColor();
        if (color) {
          transparent = color.transparent === true;
          rgb = activeRgb(color);
        }
      } catch {

      }
      if (transparent) {
        drop();
        return;
      }
      if (!rgb) rgb = pendingRgb;
      if (!rgb) return;
      if (!isOn()) return;

      const headRgb = head();
      if (headRgb && sameRgb(rgb, headRgb) && pendingRgb && !sameRgb(pendingRgb, headRgb)) {
        rgb = pendingRgb;
      }
      commit(rgb);
    } finally {
      busy = false;
    }
  };
}

function activeRgb(color) {
  const activeSlot = color.active === 'sub' ? color.sub : color.main;
  return color.rgb
    || (activeSlot && activeSlot.rgb)
    || (color.main && color.main.rgb)
    || (color.sub && color.sub.rgb)
    || null;
}

function sameRgb(a, b) {
  return Boolean(a && b && a.r === b.r && a.g === b.g && a.b === b.b);
}

module.exports = { createPointerHistory, createContactHistory };

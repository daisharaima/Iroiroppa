'use strict';

// Two pointer-driven history paths, both fed by src/main/pointer-watch.js:
//
// - `createPointerHistory` (gate OFF): a release over CSP ends a pick; take a
//   fresh SyncColorCircleUIState read and commit that colour.
// - `createContactHistory` (gate ON): a non-Alt left-button down on the CSP
//   canvas is the only thing that records. It takes a fresh read too, because the
//   cached colour can be one poll old (the PPC lesson). A pending pick is the
//   fallback when the host still reports the previous colour.

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
      /* transient; the recorder's settle still covers the pick */
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
        /* fall back to the pending pick below */
      }
      if (transparent) {
        drop();
        return;
      }
      if (!rgb) rgb = pendingRgb;
      if (!rgb) return;
      if (!isOn()) return; // the gate may have been switched off while reading
      // A lagging host read that still shows the head must not beat a newer pick.
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

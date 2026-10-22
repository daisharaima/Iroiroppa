'use strict';

// Where the palette reopens. Kept free of Electron so it can be tested without a
// display — `main.js` is not headless-requirable. All values here are DIP, the
// unit Electron's `screen` and window geometry use.

/**
 * The display a window belongs on: the one it was last seen on, else the one
 * under the cursor, else the primary. `primary` is one of `displays` in
 * practice, but it is accepted separately so a caller can pass a display that is
 * not in the list.
 * @param {{displayId?: number}|null} saved
 * @param {Array} displays
 * @param {{x: number, y: number}|null} cursor
 * @param {object} primary
 */
function pickDisplay(saved, displays, cursor, primary) {
  const list = Array.isArray(displays) && displays.length ? displays : [primary];
  if (saved && saved.displayId != null) {
    const match = list.find((d) => d.id === saved.displayId);
    if (match) return match;
  }
  if (cursor) {
    const under = list.find((d) => {
      const a = d.workArea;
      return cursor.x >= a.x && cursor.x < a.x + a.width && cursor.y >= a.y && cursor.y < a.y + a.height;
    });
    if (under) return under;
  }
  return list.find((d) => d.id === (primary && primary.id)) || list[0];
}

/**
 * Resolve saved placement to bounds that are fully usable on a display that
 * exists now. The saved display is preferred; if it is gone the window lands on
 * the cursor's or the primary display and is clamped inside its work area, so it
 * can never reopen off-screen.
 *
 * @param {{x:number,y:number,displayId?:number}|null} saved position memory
 * @param {{width:number,height:number}} size desired size (DIP)
 * @param {Array} displays Electron `screen.getAllDisplays()` result
 * @param {{x:number,y:number}|null} cursor Electron cursor point
 * @param {object} primary Electron primary display
 * @param {{width:number,height:number}} [min] minimum size (DIP)
 * @returns {{x:number,y:number,width:number,height:number,displayId:number,hadPosition:boolean}}
 */
function resolveWindowBounds(saved, size, displays, cursor, primary, min = { width: 200, height: 340 }) {
  const display = pickDisplay(saved, displays, cursor, primary);
  const wa = display.workArea;
  const maxW = Math.max(min.width, Math.round(wa.width));
  const maxH = Math.max(min.height, Math.round(wa.height));
  const width = Math.min(Math.max(min.width, Math.round(size.width)), maxW);
  const height = Math.min(Math.max(min.height, Math.round(size.height)), maxH);

  const hadPosition = Boolean(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y));
  // A position that is still inside a display which exists is used as-is. A desktop can
  // legitimately have a negative origin (a monitor left of or above the primary), and clamping
  // into the *chosen* display's work area teleported such a window to that display's corner —
  // a palette at (-600, -900) reopened at (0, 0). Only a position on no display at all is
  // clamped back into one.
  const fits = (d) => {
    const b = d && (d.bounds || d.workArea);
    if (!b) return false;
    return saved.x >= b.x && saved.x + width <= b.x + b.width
      && saved.y >= b.y && saved.y + height <= b.y + b.height;
  };
  if (hadPosition) {
    const home = (Array.isArray(displays) ? displays : []).find(fits);
    if (home) {
      return { x: Math.round(saved.x), y: Math.round(saved.y), width, height, displayId: home.id, hadPosition };
    }
  }
  let x = hadPosition ? Math.round(saved.x) : Math.round(wa.x + (wa.width - width) / 2);
  let y = hadPosition ? Math.round(saved.y) : Math.round(wa.y + (wa.height - height) / 2);
  const maxX = wa.x + Math.max(0, Math.round(wa.width) - width);
  const maxY = wa.y + Math.max(0, Math.round(wa.height) - height);
  x = Math.min(Math.max(x, wa.x), maxX);
  y = Math.min(Math.max(y, wa.y), maxY);

  return { x, y, width, height, displayId: display.id, hadPosition };
}

module.exports = { resolveWindowBounds, pickDisplay };

'use strict';

// Sender validation for the IPC surface (docs/STATE.md). Every privileged channel
// — colour writes, layout/settings/module changes — must come from a live window
// this app owns. The sender is never trusted from the payload; the window is
// resolved from the event. Pure predicates, so they are unit-tested without
// Electron (the window lookup is injected).

const isDestroyed = (o) => Boolean(o && typeof o.isDestroyed === 'function' && o.isDestroyed());

/**
 * @param {object} event an ipcMain event
 * @param {(wc:object)=>object|null} lookupWin resolves webContents to a window (injected)
 */
function isTrustedSender(event, lookupWin) {
  if (!event || !event.sender || isDestroyed(event.sender)) return false;
  const win = typeof lookupWin === 'function' ? lookupWin(event.sender) : null;
  return Boolean(win) && !isDestroyed(win);
}

/** A finite, in-range 0–255 channel value. */
function isChannel255(v) {
  return Number.isFinite(v) && v >= 0 && v <= 255;
}

module.exports = { isTrustedSender, isChannel255, isDestroyed };

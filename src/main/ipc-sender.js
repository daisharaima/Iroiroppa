'use strict';

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

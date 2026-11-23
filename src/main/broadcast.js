'use strict';

function canSend(win) {
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return false;
  const wc = win.webContents;
  if (!wc || typeof wc.send !== 'function') return false;
  if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return false;
  return true;
}

/** Send to one window's live webContents. Returns true when it was sent. */
function sendTo(win, channel, payload) {
  if (!canSend(win)) return false;
  try {
    win.webContents.send(channel, payload);
    return true;
  } catch {
    return false;
  }
}

/** Send to a bare webContents (used where no BrowserWindow lookup is available). */
function sendToWebContents(wc, channel, payload) {
  if (!wc || typeof wc.send !== 'function') return false;
  if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return false;
  try {
    wc.send(channel, payload);
    return true;
  } catch {
    return false;
  }
}

/** Send to every live window. Returns the number actually sent. */
function broadcast(windows, channel, payload) {
  let sent = 0;
  for (const win of windows) if (sendTo(win, channel, payload)) sent += 1;
  return sent;
}

module.exports = { canSend, sendTo, sendToWebContents, broadcast };

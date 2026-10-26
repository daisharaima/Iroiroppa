'use strict';

/**
 * Give a palette/float renderer a bounded self-heal path. A renderer that is
 * gone leaves the window painted but inert; reload once (twice at most) instead
 * of requiring a tray quit. The reset after five seconds prevents a renderer
 * that crashes while loading from looping forever.
 */
function attachRendererRecovery(win, label = 'renderer') {
  if (!win || win.isDestroyed()) return;
  let reloads = 0;
  let resetTimer = null;
  const recover = (reason) => {
    if (!win || win.isDestroyed() || reloads >= 2) return;
    reloads += 1;
    console.error(`[renderer] ${label} ${reason}; reloading (${reloads}/2)`);
    try { win.webContents.reload(); } catch { /* already gone */ }
  };
  win.webContents.on('render-process-gone', (_e, details) => recover(`gone:${(details && details.reason) || 'unknown'}`));
  win.webContents.on('unresponsive', () => recover('unresponsive'));
  win.webContents.on('did-finish-load', () => {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { reloads = 0; }, 5000);
    if (resetTimer.unref) resetTimer.unref();
  });
  win.on('closed', () => {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = null;
  });
}

module.exports = { attachRendererRecovery };

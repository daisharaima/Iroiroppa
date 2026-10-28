'use strict';

// The settings IPC group (docs/STATE.md).
//
// Moved out of ipc.js verbatim; `wireIpc` hands it `ctx` and the shared helpers `h`.

const fs = require('node:fs');
const {
  app, BrowserWindow, ipcMain, clipboard, dialog, screen, webContents,
} = require('electron');
const { migrateV1 } = require('../layout-store');
const { createCommandRouter } = require('../command-router');
const ModuleManifest = require('../../shared/module-manifest');
const { isChannel255 } = require('../ipc-sender');

function register(ctx, h) {
  const { instanceOf, findInstance, moduleIdOfInstance, isSingletonModule, paletteIdForSender, commitSettings, trusted } = h;  ipcMain.handle('settings:update', (e, patch) => {
    if (!trusted(e)) return null;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
    const next = commitSettings({ ...patch });
    // Auto-hide is not just a stored boolean: it owns the foreground watcher.
    // Without this, turning it on in Settings left the watcher off and the old
    // blur fallback hid the palette on any blur.
    if (Object.prototype.hasOwnProperty.call(patch, 'autoHide') && typeof ctx.applyAutoHide === 'function') {
      ctx.applyAutoHide(next ? next.autoHide !== false : patch.autoHide !== false);
    }
    // The auto-update-check toggle owns the timer, not just a stored boolean.
    if (Object.prototype.hasOwnProperty.call(patch, 'checkUpdatesAutomatically')
      && typeof ctx.scheduleAutoUpdateCheck === 'function') {
      ctx.scheduleAutoUpdateCheck();
    }
    return next;
  });
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text ?? '')); return true; });
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.on('color:write', (e, { r, g, b, immediate } = {}) => {
    if (!trusted(e)) return;
    if (!(isChannel255(r) && isChannel255(g) && isChannel255(b))) return;
    ctx.service.writeColor({ r, g, b }, { immediate });
  });
  ipcMain.on('color:preview', (e, { L, a, b, active } = {}) => {
    if (!trusted(e)) return;
    if (![L, a, b].every(Number.isFinite)) return;
    if (!(L >= 0 && L <= 1) || Math.abs(a) > 1 || Math.abs(b) > 1) return;
    ctx.service.previewColor({ L, a, b }, { sourceId: e.sender.id, active });
  });
  ipcMain.on('window:hide', () => ctx.hidePopup());
  ipcMain.on('window:move-by', (_e, { dx, dy } = {}) => {
    if (!ctx.popup || ctx.popup.isDestroyed()) return;
    // The renderer reports CSS pixels; the window is in screen (zoomed) pixels.
    const zoom = ctx.popup.webContents.getZoomFactor() || 1;
    const [x, y] = ctx.popup.getPosition();
    ctx.popup.setPosition(
      Math.round(x + (Number(dx) || 0) * zoom),
      Math.round(y + (Number(dy) || 0) * zoom),
    );
  });
  // Collapsing drops the palette to just its title bar, so the window's normal
  // minimum height has to be lifted for it (and restored on expand).
  ipcMain.on('window:collapsed', (_e, { on, height } = {}) => {
    if (!ctx.popup || ctx.popup.isDestroyed()) return;
    const z = ctx.popup.webContents.getZoomFactor() || 1;
    const [w] = ctx.popup.getContentSize();
    if (on) {
      ctx.popup.setMinimumSize(200, 20);
      ctx.popup.setContentSize(w, Math.max(20, Math.round((Number(height) || 0) * z)));
    } else {
      ctx.popup.setContentSize(w, Math.max(340, Math.round((Number(height) || 0) * z)));
      ctx.popup.setMinimumSize(200, 340);
    }
    // Persist it, so the palette reopens as it was left (the panel's own size is
    // not touched — that lives in settings until the geometry move in docs/LAYOUT.md).
    const paletteId = ctx.primaryPaletteId();
    if (paletteId) ctx.dispatchLayout({ type: 'palette.setCollapsed', paletteId, collapsed: Boolean(on) });
  });
  ipcMain.on('settings:open', () => ctx.createSettingsWindow());
  ipcMain.on('settings:close', () => { if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) ctx.settingsWin.close(); });
  // The renderer computes the minimum width that fits the longest module name
  // plus a usable settings pane; keep it so a UI-scale change re-applies it.
  ipcMain.handle('settings:min-width', (_e, { width } = {}) => {
    const css = Math.max(0, Math.round(Number(width) || 0));
    ctx.settingsMinWidthCss = css;
    if (!ctx.settingsWin || ctx.settingsWin.isDestroyed()) return css;
    const z = ctx.settingsWin.webContents.getZoomFactor() || 1;
    const minW = Math.max(1, Math.round(css * z));
    ctx.settingsWin.setMinimumSize(minW, ctx.settingsWin.getMinimumSize()[1]);
    const [cw, ch] = ctx.settingsWin.getContentSize();
    if (cw < minW) ctx.settingsWin.setContentSize(minW, ch);
    return css;
  });
  // The settings window measures its content and asks to be exactly that tall,
  // so no scrollbar is needed.
  ipcMain.on('settings:resize', (_e, { height } = {}) => {
    if (!ctx.settingsWin || ctx.settingsWin.isDestroyed()) return;
    // The renderer measures in CSS pixels; convert to the physical size the
    // zoomed window needs (its width is kept in step by applyUiScale).
    const z = ctx.settingsWin.webContents.getZoomFactor() || 1;
    const display = screen.getDisplayMatching(ctx.settingsWin.getBounds());
    const maxH = Math.max(240, display.workArea.height - 40);
    const h = Math.max(200, Math.min(maxH, Math.round((Number(height) || 0) * z)));
    const [w] = ctx.settingsWin.getContentSize();
    ctx.settingsWin.setContentSize(w, h);
    // A content resize can drop the topmost bit on this build, which buried the
    // Settings window behind the palette on the next band tick (the "it disappears
    // when I switch tabs" report). Repair the bit without re-raising the window on
    // every tab change; that raise flashed the whole Settings frame.
    if (ctx.repairTopmost) ctx.repairTopmost(ctx.settingsWin);
  });
  ipcMain.on('window:editable', (_e, on) => {
    if (!ctx.popup) return;
    // A text field needs real keyboard focus, which a non-activating window cannot
    // take: drop the native WS_EX_NOACTIVATE bit while the field is open and restore
    // it afterwards (topmost.js owns the band).
    if (ctx.setPaletteEditable) ctx.setPaletteEditable(Boolean(on));
  });
  ipcMain.on('window:resize', (_e, { width, height } = {}) => {
    if (!ctx.popup || ctx.popup.isDestroyed()) return;
    // The renderer works in CSS pixels; the window is the zoomed physical size.
    const z = ctx.popup.webContents.getZoomFactor() || 1;
    // The floor is the window's own minimum (200x340 by default), not a hard
    // constant: a board whose modules all fit their size lowers the minimum
    // (`window:min-size-self`) so it can shrink to its content.
    const [osMinW, osMinH] = ctx.popup.getMinimumSize();
    const w = Math.max(Math.round(osMinW / z), Math.min(900, Math.round(Number(width) || 0)));
    const h = Math.max(Math.round(osMinH / z), Math.min(1400, Math.round(Number(height) || 0)));
    ctx.popupDesign = { width: w, height: h };
    ctx.popup.setContentSize(Math.round(w * z), Math.round(h * z));
  });
  ipcMain.on('app:quit', () => { ctx.quoted = true; app.quit(); });

}

module.exports = { register };

'use strict';

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

    if (Object.prototype.hasOwnProperty.call(patch, 'autoHide') && typeof ctx.applyAutoHide === 'function') {
      ctx.applyAutoHide(next ? next.autoHide !== false : patch.autoHide !== false);
    }

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

    const zoom = ctx.popup.webContents.getZoomFactor() || 1;
    const [x, y] = ctx.popup.getPosition();
    ctx.popup.setPosition(
      Math.round(x + (Number(dx) || 0) * zoom),
      Math.round(y + (Number(dy) || 0) * zoom),
    );
  });

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

    const paletteId = ctx.primaryPaletteId();
    if (paletteId) ctx.dispatchLayout({ type: 'palette.setCollapsed', paletteId, collapsed: Boolean(on) });
  });
  ipcMain.on('settings:open', () => ctx.createSettingsWindow());
  ipcMain.on('settings:close', () => { if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) ctx.settingsWin.close(); });

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

  ipcMain.on('settings:resize', (_e, { height } = {}) => {
    if (!ctx.settingsWin || ctx.settingsWin.isDestroyed()) return;

    const z = ctx.settingsWin.webContents.getZoomFactor() || 1;
    const display = screen.getDisplayMatching(ctx.settingsWin.getBounds());
    const maxH = Math.max(240, display.workArea.height - 40);
    const h = Math.max(200, Math.min(maxH, Math.round((Number(height) || 0) * z)));
    const [w] = ctx.settingsWin.getContentSize();
    ctx.settingsWin.setContentSize(w, h);

    if (ctx.repairTopmost) ctx.repairTopmost(ctx.settingsWin);
  });
  ipcMain.on('window:editable', (_e, on) => {
    if (!ctx.popup) return;

    if (ctx.setPaletteEditable) ctx.setPaletteEditable(Boolean(on));
  });
  ipcMain.on('window:resize', (_e, { width, height } = {}) => {
    if (!ctx.popup || ctx.popup.isDestroyed()) return;

    const z = ctx.popup.webContents.getZoomFactor() || 1;

    const [osMinW, osMinH] = ctx.popup.getMinimumSize();
    const w = Math.max(Math.round(osMinW / z), Math.min(900, Math.round(Number(width) || 0)));
    const h = Math.max(Math.round(osMinH / z), Math.min(1400, Math.round(Number(height) || 0)));
    ctx.popupDesign = { width: w, height: h };
    ctx.popup.setContentSize(Math.round(w * z), Math.round(h * z));
  });
  ipcMain.on('app:quit', () => { ctx.quoted = true; app.quit(); });

}

module.exports = { register };

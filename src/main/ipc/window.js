'use strict';

const fs = require('node:fs');
const {
  app, BrowserWindow, ipcMain, clipboard, dialog, screen, webContents,
} = require('electron');
const { migrateV1 } = require('../layout-store');
const { createCommandRouter } = require('../command-router');
const ModuleManifest = require('../../shared/module-manifest');
const { sendTo } = require('../broadcast');
const { isChannel255 } = require('../ipc-sender');

function register(ctx, h) {
  const { instanceOf, findInstance, moduleIdOfInstance, isSingletonModule, paletteIdForSender, commitSettings, trusted } = h;

  const typingSenders = new Set();
  const typingWatched = new Set();
  ipcMain.on('ui:typing', (event, on) => {
    const id = event.sender && event.sender.id;
    if (!id) return;
    if (!typingWatched.has(id)) {
      typingWatched.add(id);
      try { event.sender.once('destroyed', () => { typingSenders.delete(id); typingWatched.delete(id); }); } catch {  }
    }
    if (on) typingSenders.add(id); else typingSenders.delete(id);
    if (ctx.setBareTypingShortcut) ctx.setBareTypingShortcut(typingSenders.size > 0);
  });
  ipcMain.handle('window:bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;
    const b = win.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  ipcMain.on('board:metrics', (event, metrics) => {

    const paletteId = paletteIdForSender(event.sender);
    if (!paletteId || !metrics || !metrics.boxes || !Array.isArray(metrics.boxes.columns)) return;
    ctx.boardMetrics.set(paletteId, {
      pad: Number.isFinite(metrics.pad) ? metrics.pad : undefined,
      minWidth: Number.isFinite(metrics.minWidth) ? metrics.minWidth : undefined,
      minHeight: Number.isFinite(metrics.minHeight) ? metrics.minHeight : undefined,
      boxes: metrics.boxes,
    });
  });
  ipcMain.on('drag:begin', (event, payload = {}) => {

    const paletteId = paletteIdForSender(event.sender);
    if (!paletteId) return;

    if (typeof ctx.clearShortcutPlacement === 'function') ctx.clearShortcutPlacement(paletteId);

    if (typeof ctx.cancelPendingMerge === 'function') ctx.cancelPendingMerge();

    ctx.closeOverlayMenu();
    if (ctx.isDev) console.log('[drag] begin', (payload && payload.kind) || 'modules', paletteId);

    if (payload && payload.kind === 'palette') {
      const members = ctx.paletteDragMembers(paletteId);
      if (!members.length) return;
      const pal = ctx.layoutPalette(paletteId);
      const items = pal
        ? pal.columns.flatMap((c) => c.modules.map((m) => m.instanceId))
        : [];

      const lead = members[0];
      const win = BrowserWindow.fromWebContents(event.sender);
      const itemSize = win && !win.isDestroyed()
        ? (() => {
          const b = win.getBounds();
          const z = (win.webContents && win.webContents.getZoomFactor && win.webContents.getZoomFactor()) || 1;
          return { width: b.width / z, height: b.height / z };
        })()
        : (lead ? { width: lead.width, height: lead.height } : undefined);
      ctx.dragSession.begin({ ...payload, sourcePaletteId: paletteId, members, items, itemSize });
      return;
    }
    ctx.dragSession.begin({
      sourcePaletteId: paletteId,
      items: Array.isArray(payload.items) ? payload.items : [],
      grouping: payload.grouping === 'columns' ? 'columns' : 'flat',
      text: payload.text,
      hint: Boolean(payload.hint),
      width: payload.width,
      height: payload.height,
    });
  });
  ipcMain.handle('drag:drop', (event) => {
    if (!paletteIdForSender(event.sender)) return { ok: false, error: 'unknown-window' };
    const result = ctx.dragSession.drop();
    if (result && result.pendingMerge && typeof ctx.beginPaletteMerge === 'function') {
      ctx.beginPaletteMerge(result.pendingMerge);
    }
    return result;
  });
  ipcMain.on('drag:cancel', (event) => {
    if (!paletteIdForSender(event.sender)) return;
    ctx.dragSession.cancel();
  });
  ipcMain.handle('drag:place', (event, payload = {}) => {

    if (!paletteIdForSender(event.sender)) return { ok: false, error: 'unknown-window' };
    const items = Array.isArray(payload.items) ? payload.items.filter((id) => typeof id === 'string') : [];
    if (!items.length || !payload.target) return { ok: false, error: 'bad-place' };

    const target = { ...payload.target };
    if (!target.paletteId && target.kind !== 'desktop') target.paletteId = paletteIdForSender(event.sender);
    const intent = { type: 'layout.place', items, target, grouping: payload.grouping === 'columns' ? 'columns' : 'flat' };
    if (Number.isFinite(payload.width)) intent.width = payload.width;
    return ctx.applyLayoutIntent(intent);
  });
  ipcMain.handle('history:get', () => ctx.historyList().map((c) => ({ ...c })));

  ipcMain.on('history:add', (_e, rgb) => ctx.commitHistory(rgb));
  ipcMain.on('float:remove', (_e, { floatId } = {}) => ctx.removeFloat(floatId));
  ipcMain.on('float:dock', (_e, spec) => ctx.dockFloatModule(spec || {}));
  ipcMain.on('float:remove-module', (_e, { moduleId } = {}) => ctx.removeModuleFromFloats(moduleId));
  ipcMain.on('drag:overlay', (event, spec) => {
    ctx.overlayPreview = true;
    ctx.showOverlay(event.sender, { ...(spec || {}), preview: true });
  });

  ipcMain.on('tooltip:show', (event, spec = {}) => {
    if (ctx.showTooltip) ctx.showTooltip(event.sender, spec);
  });
  ipcMain.on('tooltip:hide', () => { if (ctx.hideTooltip) ctx.hideTooltip(); });
  ipcMain.on('palette:menu', (event, spec) => ctx.showOverlayMenu(event.sender, spec || {}));
  ipcMain.on('overlay:menu:close', () => ctx.closeOverlayMenu());
  ipcMain.on('overlay:confirm:pick', (event, spec = {}) => {

    if (!ctx.overlayWin || event.sender !== ctx.overlayWin.webContents) return;
    if (typeof ctx.resolvePendingMerge === 'function') ctx.resolvePendingMerge(spec.ok === true);
  });
  ipcMain.on('module-settings:close', () => ctx.closeModuleSettingsWindow());

  ipcMain.on('input:trace', (_event, rec) => { if (ctx.traceInput && rec) ctx.traceInput(rec); });

  ipcMain.on('input:press', (event) => { if (ctx.reassertBand) ctx.reassertBand(event.sender); });
  ipcMain.on('overlay:menu:pick', (_event, spec = {}) => {
    const menu = ctx.overlayMenu;
    if (!menu) return;
    const item = menu.items[Number(spec.index) || 0];
    const source = BrowserWindow.getAllWindows()
      .find((win) => !win.isDestroyed() && win.webContents.id === menu.senderId);
    ctx.closeOverlayMenu();
    if (item && source) sendTo(source, 'palette:menu:pick', { id: item.id, menu: menu.menu || 'palette' });
  });
  ipcMain.on('window:move-by-self', (event, { dx, dy } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const zoom = win.webContents.getZoomFactor() || 1;
    const [x, y] = win.getPosition();
    win.setPosition(
      Math.round(x + (Number(dx) || 0) * zoom),
      Math.round(y + (Number(dy) || 0) * zoom),
    );
  });
  ipcMain.on('window:resize-self', (event, { width, height } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;

    const z = win.webContents.getZoomFactor() || 1;
    const before = win.getBounds();
    const [w, h] = win.getContentSize();
    const cssW = Math.max(1, Math.round(Number(width) || w / z));
    const cssH = Math.max(1, Math.round(Number(height) || h / z));
    win.setContentSize(Math.round(cssW * z), Math.round(cssH * z));

    const paletteId = paletteIdForSender(event.sender);
    const palette = paletteId ? ctx.layoutPalette(paletteId) : null;
    if (!palette) return;
    win.__selfResizeAt = Date.now();
    const after = win.getBounds();
    const followers = ctx.snapFollowers ? ctx.snapFollowers(paletteId) : [];
    const edges = new Set();
    if (palette.snap) {

      const mirror = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
      edges.add(mirror[palette.snap]);
    }

    for (const f of followers) edges.add(f.snap);
    let x = after.x;
    let y = after.y;
    if (edges.has('right')) x = before.x + before.width - after.width;
    if (edges.has('bottom')) y = before.y + before.height - after.height;
    if (x !== after.x || y !== after.y) win.setPosition(x, y);
  });

  ipcMain.on('window:min-size-self', (event, { width, height } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const z = win.webContents.getZoomFactor() || 1;
    win.setMinimumSize(
      Math.max(1, Math.round((Number(width) || 0) * z)),
      Math.max(1, Math.round((Number(height) || 0) * z)),
    );
  });
  ipcMain.on('window:set-resizable-self', (event, { resizable } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.setResizable(Boolean(resizable));
  });

  ipcMain.on('float:collapsed', (_e, { floatId, collapsed } = {}) => ctx.setFloatCollapsed(floatId, collapsed));
  ipcMain.handle('moduleSettings:open', (_e, spec) => ctx.openModuleSettingsWindow(spec));
  ipcMain.on('moduleSettings:close', () => ctx.closeModuleSettingsWindow());
  ipcMain.on('moduleSettings:resize', (_e, { height } = {}) => {
    if (!ctx.moduleSettingsWin || ctx.moduleSettingsWin.isDestroyed()) return;
    const z = ctx.moduleSettingsWin.webContents.getZoomFactor() || 1;
    const display = screen.getDisplayMatching(ctx.moduleSettingsWin.getBounds());
    const maxH = Math.max(120, display.workArea.height - 40);
    const [w] = ctx.moduleSettingsWin.getContentSize();
    const h = Math.max(60, Math.min(maxH, Math.round((Number(height) || 0) * z)));
    ctx.moduleSettingsWin.setContentSize(w, h);

    if (ctx.repairTopmost) ctx.repairTopmost(ctx.moduleSettingsWin);
  });

  ipcMain.handle('lens:open', (_e, spec) => ctx.openLensWindow(spec));
  ipcMain.on('lens:close', () => ctx.closeLensWindow());
  ipcMain.on('lens:resize', (_e, { height } = {}) => {
    if (!ctx.lensWin || ctx.lensWin.isDestroyed()) return;
    const z = ctx.lensWin.webContents.getZoomFactor() || 1;
    const display = screen.getDisplayMatching(ctx.lensWin.getBounds());
    const maxH = Math.max(160, display.workArea.height - 40);
    const [w] = ctx.lensWin.getContentSize();
    const h = Math.max(80, Math.min(maxH, Math.round((Number(height) || 0) * z)));
    ctx.lensWin.setContentSize(w, h);

    ctx.lensWin.__lastResize = Date.now();
    if (ctx.repairTopmost) ctx.repairTopmost(ctx.lensWin);
  });

  ipcMain.on('lens:set', (event, { instanceId, lens } = {}) => {
    if (!instanceId) return;
    const payload = { instanceId, lens: lens || null };

    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents === event.sender) continue;
      sendTo(win, 'lens:apply', payload);
    }
  });

}

module.exports = { register };

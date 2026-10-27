'use strict';

// The window IPC group (docs/STATE.md).
//
// Moved out of ipc.js verbatim; `wireIpc` hands it `ctx` and the shared helpers `h`.

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
  const { instanceOf, findInstance, moduleIdOfInstance, isSingletonModule, paletteIdForSender, commitSettings, trusted } = h;  ipcMain.handle('window:bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;
    const b = win.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  ipcMain.on('board:metrics', (event, metrics) => {
    // What a board drew, for the drop resolver to prefer over the model.
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
    // A board starts a drag for what it is holding; main owns the rest (V4).
    const paletteId = paletteIdForSender(event.sender);
    if (!paletteId) return;
    // A drag must not land on the open palette menu (the overlay window draws
    // both): close it so the indicator cannot be painted over the menu and the
    // menu cannot read as a drop target.
    ctx.closeOverlayMenu();
    if (ctx.isDev) console.log('[drag] begin', (payload && payload.kind) || 'modules', paletteId);
    // A whole-palette drag (a titlebar/grip, not a module): main works out the snap group and the
    // drag session moves the windows with the pointer, so the move is visible (docs/LAYOUT.md,
    // "Snapping"). `items` is the group's modules, so releasing over another palette docks them.
    if (payload && payload.kind === 'palette') {
      const members = ctx.paletteDragMembers(paletteId);
      if (!members.length) return;
      const pal = ctx.layoutPalette(paletteId);
      const items = pal
        ? pal.columns.flatMap((c) => c.modules.map((m) => m.instanceId))
        : [];
      // Where the group is and how big it is: the session moves the windows and, released over
      // another palette, needs the dragged window's own size for the size rule.
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
    return result;
  });
  ipcMain.on('drag:cancel', (event) => {
    if (!paletteIdForSender(event.sender)) return;
    ctx.dragSession.cancel();
  });
  ipcMain.handle('drag:place', (event, payload = {}) => {
    // A programmatic drop to a target the caller already resolved (the --board-drag
    // flag, and the board's own dragTo/moveModule). The intent is the same one the
    // session dispatches, so there is one path into the document.
    if (!paletteIdForSender(event.sender)) return { ok: false, error: 'unknown-window' };
    const items = Array.isArray(payload.items) ? payload.items.filter((id) => typeof id === 'string') : [];
    if (!items.length || !payload.target) return { ok: false, error: 'bad-place' };
    // The caller may omit the target's palette — for a programmatic drop it is the
    // window that asked, which main knows from the sender.
    const target = { ...payload.target };
    if (!target.paletteId && target.kind !== 'desktop') target.paletteId = paletteIdForSender(event.sender);
    const intent = { type: 'layout.place', items, target, grouping: payload.grouping === 'columns' ? 'columns' : 'flat' };
    if (Number.isFinite(payload.width)) intent.width = payload.width;
    return ctx.applyLayoutIntent(intent);
  });
  ipcMain.handle('history:get', () => ctx.historyList().map((c) => ({ ...c })));
  // An explicit pick from a window. Main's recorder cancels a host colour that is
  // still settling, so an older CSP pick can never land after this one.
  ipcMain.on('history:add', (_e, rgb) => ctx.commitHistory(rgb));
  ipcMain.on('float:remove', (_e, { floatId } = {}) => ctx.removeFloat(floatId));
  ipcMain.on('float:dock', (_e, spec) => ctx.dockFloatModule(spec || {}));
  ipcMain.on('float:remove-module', (_e, { moduleId } = {}) => ctx.removeModuleFromFloats(moduleId));
  ipcMain.on('drag:overlay', (event, spec) => ctx.showOverlay(event.sender, spec || {}));
  // The palette menu lives in the overlay window (see `showOverlayMenu`): the palette asks for it, the
  // overlay reports which item was clicked, and main forwards the choice back to the window that asked.
  ipcMain.on('tooltip:show', (event, spec = {}) => {
    if (ctx.showTooltip) ctx.showTooltip(event.sender, spec);
  });
  ipcMain.on('tooltip:hide', () => { if (ctx.hideTooltip) ctx.hideTooltip(); });
  ipcMain.on('palette:menu', (event, spec) => ctx.showOverlayMenu(event.sender, spec || {}));
  ipcMain.on('overlay:menu:close', () => ctx.closeOverlayMenu());
  ipcMain.on('module-settings:close', () => ctx.closeModuleSettingsWindow());
  // `--trace-input`: every pointer event a page receives, plus the state of the
  // window it arrived in, so a palette that paints but takes no clicks can say
  // where the press stopped (docs/DEV.md).
  ipcMain.on('input:trace', (_event, rec) => { if (ctx.traceInput && rec) ctx.traceInput(rec); });
  // A press rewrites the window's extended style (Chromium tries to activate it and
  // drops WS_EX_TOPMOST), so the band is re-asserted from the window that pressed.
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
    // The renderer works in CSS pixels; the window is the zoomed physical size.
    const z = win.webContents.getZoomFactor() || 1;
    const before = win.getBounds();
    const [w, h] = win.getContentSize();
    const cssW = Math.max(1, Math.round(Number(width) || w / z));
    const cssH = Math.max(1, Math.round(Number(height) || h / z));
    win.setContentSize(Math.round(cssW * z), Math.round(cssH * z));
    // A content fit keeps the top-left fixed. When one of this palette's edges is
    // shared with a neighbour, moving it would open a gap; pin the shared edge by
    // moving the window by the size delta instead.
    const paletteId = paletteIdForSender(event.sender);
    const palette = paletteId ? ctx.layoutPalette(paletteId) : null;
    if (!palette) return;
    win.__selfResizeAt = Date.now();
    const after = win.getBounds();
    const followers = ctx.snapFollowers ? ctx.snapFollowers(paletteId) : [];
    const edges = new Set();
    if (palette.snap) {
      // `snap` names the side of the anchor; the palette's own touching edge is the
      // mirror of it.
      const mirror = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
      edges.add(mirror[palette.snap]);
    }
    // A follower's `snap` names the side of this palette it sits on.
    for (const f of followers) edges.add(f.snap);
    let x = after.x;
    let y = after.y;
    if (edges.has('right')) x = before.x + before.width - after.width;
    if (edges.has('bottom')) y = before.y + before.height - after.height;
    if (x !== after.x || y !== after.y) win.setPosition(x, y);
  });
  // A collapsed float has to shrink below the normal minimum; the renderer asks
  // for the smaller minimum while collapsed and the normal one on expand. A
  // *resizable* window also has a Windows-enforced minimum height, so the
  // renderer drops `resizable` while collapsed too.
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
  // Main must not remember a collapsed float's size as its own.
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
    // The popout is measured and resized right after it opens; a resize drops the
    // topmost bit here, and the palette's band watchdog then put the palette over it.
    if (ctx.reassertTopmost) ctx.reassertTopmost(ctx.moduleSettingsWin);
  });

}

module.exports = { register };

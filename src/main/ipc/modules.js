'use strict';

// The modules IPC group (docs/STATE.md).
//
// Moved out of ipc.js verbatim: it uses only `ctx` plus the sender guard `trusted`.
// `wireIpc` calls `register(ctx, trusted)`.

const { ipcMain } = require('electron');
const { sendTo } = require('../broadcast');
const LayoutModel = require('../../shared/layout-model');

function register(ctx, trusted) {
  ipcMain.handle('modules:get', (_e, id, fallbackId) => ctx.readModuleSettings(id, fallbackId));
  ipcMain.handle('modules:list', () => ctx.listModuleIds());
  /**
   * The Trash section of Settings → Modules: settings files nothing uses (an instance that was
   * deleted or a module that no longer exists). `moduleStore.listUnused` keeps a file whose id is
   * still in the workspace, placed or hidden.
   */
  const workspaceInstanceIds = () => LayoutModel.liveInstanceIds(ctx.currentWorkspace());
  ipcMain.handle('modules:trash', () => {
    const files = ctx.moduleStore.listUnused(workspaceInstanceIds());
    return {
      files: files.map((f) => ({ id: f.id, ageDays: f.ageDays })),
      total: files.length,
    };
  });
  ipcMain.handle('modules:purge', () => {
    const removed = ctx.moduleStore.purgeUnused(workspaceInstanceIds());
    return { removed: removed.length, ids: removed };
  });
  // Trash preview + restore: a settings file whose instance is gone. Restoring puts
  // the settings back by re-adding an instance of the module the file records.
  ipcMain.handle('modules:trash:preview', (_e, { id } = {}) => {
    const file = ctx.moduleStore.readSettingsFileFull(id);
    if (!file) return { ok: false, error: 'unreadable' };
    return { ok: true, moduleId: file.moduleId || null, settings: file.settings || {} };
  });
  ipcMain.handle('modules:trash:restore', (_e, { id } = {}) => {
    const file = ctx.moduleStore.readSettingsFileFull(id);
    if (!file) return { ok: false, error: 'the file is unreadable' };
    if (!file.moduleId) return { ok: false, error: 'this file does not say which module it belonged to' };
    const copyId = ctx.mintInstanceId('i');
    const out = ctx.applyLayoutIntent({ type: 'module.enable', moduleId: file.moduleId, instanceId: copyId, lone: true });
    if (!out || !out.ok) return out || { ok: false, error: 'the workspace refused the instance' };
    ctx.moduleStore.copySettings(id, copyId, file.moduleId);
    ctx.moduleStore.removeSettingsFile(id);
    return { ...out, instanceId: copyId };
  });
  ipcMain.handle('modules:set', (event, { id, settings, version, moduleId } = {}) => {
    if (!trusted(event)) return false;
    if (typeof id !== 'string' || !settings || typeof settings !== 'object') return false;
    const ok = ctx.writeModuleSettings(id, settings, version, moduleId);
    // A change made in one window must reach every other window's copy: the
    // palette's board, a float, and the Settings window's live preview.
    if (ok) {
      // paletteWindows() already includes the floats; pushing them again sent
      // module:changed twice to every float.
      const targets = [...ctx.paletteWindows(), ctx.settingsWin];
      for (const win of targets) {
        if (win && !win.isDestroyed() && win.webContents !== event.sender) {
          sendTo(win, 'module:changed', { id });
        }
      }
    }
    return ok;
  });
}

module.exports = { register };

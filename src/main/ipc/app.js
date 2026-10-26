'use strict';

// The app / companion / proof / themes IPC group (docs/STATE.md).
//
// Moved out of ipc.js verbatim: it uses only `ctx` and Electron's app/dialog/shell,
// so it needs no inner helpers. `wireIpc` calls `register(ctx)`.

const { app, ipcMain, dialog, shell } = require('electron');

function register(ctx, trusted = () => false) {
  ipcMain.handle('app:snapshot', () => ({ ...ctx.service.snapshot(), capabilities: ctx.capabilities.state() }));
  ipcMain.handle('capabilities:get', () => ctx.capabilities.state());
  // The canonical state model (docs/STATE.md, §4.3): a window pulls the whole
  // envelope once and then follows `state:changed`. Main is the only writer, so an
  // intent is a *request* to change something, never a direct write.
  ipcMain.handle('state:get', () => (ctx.stateHub ? ctx.stateHub.snapshot() : { version: 1, domains: {} }));
  ipcMain.handle('state:intent', (_e, { name, payload } = {}) => (
    typeof ctx.applyStateIntent === 'function'
      ? ctx.applyStateIntent(name, payload)
      : { ok: false, error: `unknown intent "${name}"` }));
  // A window announces itself to the peer hub (docs/STATE.md, §12.3).
  ipcMain.on('peer:hello', (e, meta = {}) => {
    if (!ctx.peerHub) return;
    ctx.peerHub.openWindow(e.sender.id, meta || {});
    if (typeof ctx.broadcastPeers === 'function') ctx.broadcastPeers();
    e.sender.send('peer:event', { type: 'state', data: { current: ctx.peerHub.state() } });
    e.sender.send('peer:peers', ctx.peerHub.peers().map((p) => ({
      peerId: p.peerId, wcId: p.wcId, kind: p.kind, title: p.title,
    })));
  });
  ipcMain.handle('capture:sources', () => ctx.capture.sources());
  ipcMain.handle('csp:shortcuts', () => ctx.shortcutList());
  ipcMain.handle('i18n:locales', () => ctx.localeCodes());
  ipcMain.handle('csp:invoke', async (event, spec = {}) => {
    // A key send reaches a PowerShell helper, so the channel is privileged: act only
    // for a live window this app owns (docs/STATE.md).
    if (!trusted(event)) return { ok: false, error: 'untrusted sender' };
    // The protocol first (if it can invoke), then a key send as the fallback
    //.
    if (spec.quickIndex != null && ctx.service && typeof ctx.service.quickAccess === 'function') {
      const viaProtocol = await ctx.service.quickAccess(spec.quickIndex);
      if (viaProtocol && viaProtocol.ok) return viaProtocol;
    }
    if (spec.accel && ctx.sender) return ctx.sender.sendKeys(spec.accel);
    return { ok: false, error: 'no invoke path' };
  });
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('update:get', () => ctx.updateInfo);
  ipcMain.handle('update:check', () => ctx.refreshUpdateCheck());
  // The renderer cannot navigate under its CSP, so links are opened here, and
  // only ever to this project's GitHub.
  ipcMain.handle('shell:openExternal', (_e, url) => {
    const s = String(url || '');
    if (!/^https:\/\/github\.com\/daisharaima\/Iroiroppa\//i.test(s)) return false;
    shell.openExternal(s);
    return true;
  });
  ipcMain.handle('companion:pair', () => ctx.startPairing());
  ipcMain.handle('companion:pairWithPayload', (_e, payload) => ctx.service.pairWithPayload(payload));
  ipcMain.handle('companion:cancelScan', () => {
    // The user asked to stop: don't immediately auto-connect again.
    ctx.autoConnectResumeAt = Date.now() + 60000;
    return ctx.service.cancelScan();
  });
  ipcMain.handle('companion:reconnect', () => ctx.service.connectSaved());
  ipcMain.handle('companion:disconnect', (_e, { forget } = {}) => {
    // An explicit Disconnect/Forget must not be undone by auto-connect 100 ms later
    // (the disconnect sets the status to idle, which is an auto-connect state).
    ctx.autoConnectResumeAt = Date.now() + 60000;
    return ctx.service.disconnect({ forget });
  });
  ipcMain.handle('companion:selectSlot', (_e, slot) => ctx.service.selectSlot(slot));
  ipcMain.handle('proof:get', () => {
    const result = ctx.getProof();
    return result; // { ok, path, error?, profile? }
  });
  ipcMain.handle('proof:list', (_e, { refresh } = {}) => {
    if (refresh) ctx.clearProofCaches();
    return ctx.listProofProfiles();
  });
  ipcMain.handle('proof:browse', async () => {
    const res = await dialog.showOpenDialog({
      title: ctx.t('dialog.chooseIcc'),
      properties: ['openFile'],
      filters: [{ name: 'ICC profiles', extensions: ['icc', 'icm'] }],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });
  ipcMain.handle('shortcut:resolve', (_e, root) => ctx.resolveCspFolder(root));
  ipcMain.handle('shortcut:browseRoot', async (_e, current) => {
    const fallback = ctx.resolveCspFolder('').root || undefined;
    const res = await dialog.showOpenDialog({
      title: ctx.t('dialog.chooseCspFolder'),
      defaultPath: typeof current === 'string' && current ? current : fallback,
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const picked = res.filePaths[0];
    return { path: picked, ...ctx.resolveCspFolder(picked) };
  });
  ipcMain.handle('themes:list', () => ctx.listThemes());
}

module.exports = { register };

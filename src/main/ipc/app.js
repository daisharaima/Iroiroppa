'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, dialog, shell } = require('electron');
const { ALLOWED_URLS } = require('../../shared/credits');
const { sendToWebContents } = require('../broadcast');

/** The app documents the About tab can read (and open) by fixed name. */
const ABOUT_FILES = {
  license: 'LICENSE',
  notice: 'NOTICE',
  thirdParty: 'THIRD_PARTY.md',
};

/** The first readable candidate for a shipped document. */
function readShipped(name) {
  const rel = ABOUT_FILES[name];
  if (!rel) return '';
  const candidates = [
    path.join(app.getAppPath(), rel),
    path.join(process.resourcesPath || '', rel),
    path.join(__dirname, '..', '..', '..', rel),
  ];
  for (const file of candidates) {
    try { return fs.readFileSync(file, 'utf8'); } catch {  }
  }
  return '';
}

/** Local, fixed files the About tab can open in the OS (never an arbitrary path). */
function aboutPath(name) {
  if (name === 'data') return app.getPath('userData');
  if (Object.prototype.hasOwnProperty.call(ABOUT_FILES, name)) {
    const rel = ABOUT_FILES[name];
    const candidates = [
      path.join(app.getAppPath(), rel),
      path.join(process.resourcesPath || '', rel),
      path.join(__dirname, '..', '..', '..', rel),
    ];
    return candidates.find((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } }) || '';
  }
  const root = path.dirname(process.execPath);
  if (name === 'electronLicense') {
    return [
      path.join(root, 'LICENSE.electron.txt'),
      path.join(root, 'LICENSE'),
      path.join(__dirname, '..', '..', '..', 'node_modules', 'electron', 'dist', 'LICENSE'),
    ].find((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } }) || '';
  }
  if (name === 'chromiumNotices') {
    return [
      path.join(root, 'LICENSES.chromium.html'),
      path.join(__dirname, '..', '..', '..', 'node_modules', 'electron', 'dist', 'LICENSES.chromium.html'),
    ].find((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } }) || '';
  }
  return '';
}

function register(ctx, trusted = () => false) {
  ipcMain.handle('app:snapshot', () => ({ ...ctx.service.snapshot(), capabilities: ctx.capabilities.state() }));
  ipcMain.handle('capabilities:get', () => ctx.capabilities.state());

  ipcMain.handle('state:get', () => (ctx.stateHub ? ctx.stateHub.snapshot() : { version: 1, domains: {} }));
  ipcMain.handle('state:intent', (_e, { name, payload } = {}) => (
    typeof ctx.applyStateIntent === 'function'
      ? ctx.applyStateIntent(name, payload)
      : { ok: false, error: `unknown intent "${name}"` }));

  ipcMain.on('peer:hello', (e, meta = {}) => {
    if (!ctx.peerHub) return;
    ctx.peerHub.openWindow(e.sender.id, meta || {});
    if (typeof ctx.broadcastPeers === 'function') ctx.broadcastPeers();
    sendToWebContents(e.sender, 'peer:event', { type: 'state', data: { current: ctx.peerHub.state() } });
    sendToWebContents(e.sender, 'peer:peers', ctx.peerHub.peers().map((p) => ({
      peerId: p.peerId, wcId: p.wcId, kind: p.kind, title: p.title,
    })));
  });
  ipcMain.handle('capture:sources', () => ctx.capture.sources());
  ipcMain.handle('csp:shortcuts', () => ctx.shortcutList());
  ipcMain.handle('i18n:locales', () => ctx.localeCodes());
  ipcMain.handle('csp:invoke', async (event, spec = {}) => {

    if (!trusted(event)) return { ok: false, error: 'untrusted sender' };

    const qa = spec && spec.quickAccess;
    if (qa && typeof qa === 'object') {
      if (qa.op === 'read' && ctx.service && typeof ctx.service.readQuickAccess === 'function') {
        const out = await ctx.service.readQuickAccess(qa.names);

        if (out && out.ok && typeof ctx.noteQuickAccessState === 'function') ctx.noteQuickAccessState(out);
        return out;
      }      if (qa.op === 'click' && ctx.service && typeof ctx.service.clickQuickAccess === 'function') {
        return ctx.service.clickQuickAccess(qa.name);
      }
      return { ok: false, error: 'bad quickAccess spec' };
    }

    if (spec.quickIndex != null && ctx.service && typeof ctx.service.quickAccess === 'function') {
      const viaProtocol = await ctx.service.quickAccess(spec.quickIndex);
      if (viaProtocol && viaProtocol.ok) return viaProtocol;
    }
    if (spec.accel && ctx.sender) return ctx.sender.sendKeys(spec.accel);
    return { ok: false, error: 'no invoke path' };
  });

  ipcMain.handle('csp:watch', (event, names) => {
    if (!trusted(event)) return { ok: false, error: 'untrusted sender' };
    if (!ctx.quickState) return { ok: false, error: 'unavailable' };
    const owner = String(event.sender.id || 'window');
    const count = ctx.quickState.watch(owner, names);
    return { ok: true, watching: count };
  });
  ipcMain.handle('csp:unwatch', (event) => {
    if (!trusted(event)) return { ok: false, error: 'untrusted sender' };
    if (!ctx.quickState) return { ok: false, error: 'unavailable' };
    ctx.quickState.unwatch(String(event.sender.id || 'window'));
    return { ok: true };
  });
  ipcMain.handle('csp:quickState', () => {
    if (!ctx.quickState) return { ok: false, error: 'unavailable' };
    return { ok: true, ...ctx.quickState.state(), busy: ctx.quickState.isBusy() };
  });

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('app:about', () => ({
    version: app.getVersion(),
    build: ctx.isPortable && ctx.isPortable() ? 'portable' : (app.isPackaged ? 'installer' : 'development'),
    electron: process.versions.electron || '',
    chrome: process.versions.chrome || '',
    node: process.versions.node || '',
    platform: process.platform,
    arch: process.arch,
    dataDir: app.getPath('userData'),
  }));

  ipcMain.handle('about:text', (_e, name) => {
    const key = String(name || '');
    if (key === 'electronLicense') {
      const file = aboutPath(key);
      try { return file ? fs.readFileSync(file, 'utf8') : ''; } catch { return ''; }
    }
    return readShipped(key);
  });
  ipcMain.handle('about:open', (_e, name) => {
    const target = aboutPath(String(name || ''));
    if (!target) return false;
    shell.openPath(target).catch(() => {});
    return true;
  });
  ipcMain.handle('whats-new:get', () => (typeof ctx.getWhatsNew === 'function' ? ctx.getWhatsNew() : null));
  ipcMain.handle('whats-new:seen', () => {
    if (typeof ctx.markWhatsNewSeen === 'function') ctx.markWhatsNewSeen();
    return true;
  });
  ipcMain.handle('whats-new:open', () => Boolean(ctx.openWhatsNew && ctx.openWhatsNew()));
  ipcMain.handle('update:get', () => ctx.updateInfo);
  ipcMain.handle('update:check', () => ctx.refreshUpdateCheck());
  ipcMain.handle('update:install', () => (typeof ctx.installUpdate === 'function'
    ? ctx.installUpdate()
    : { ok: false, error: 'Updates are not available in this build.' }));

  ipcMain.handle('shell:openExternal', (_e, url) => {
    const s = String(url || '');
    const repoLink = /^https:\/\/github\.com\/daisharaima\/Iroiroppa(?:\/|$)/i.test(s);
    if (!repoLink && !ALLOWED_URLS.has(s)) return false;
    shell.openExternal(s);
    return true;
  });
  ipcMain.handle('companion:pair', () => ctx.startPairing());
  ipcMain.handle('companion:pairWithPayload', (_e, payload) => ctx.service.pairWithPayload(payload));
  ipcMain.handle('companion:cancelScan', () => {

    ctx.autoConnectResumeAt = Date.now() + 60000;
    return ctx.service.cancelScan();
  });
  ipcMain.handle('companion:reconnect', () => ctx.service.connectSaved());
  ipcMain.handle('companion:disconnect', (_e, { forget } = {}) => {

    ctx.autoConnectResumeAt = Date.now() + 60000;
    return ctx.service.disconnect({ forget });
  });
  ipcMain.handle('companion:selectSlot', (_e, slot) => ctx.service.selectSlot(slot));
  ipcMain.handle('proof:get', () => {
    const result = ctx.getProof();
    return result;
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

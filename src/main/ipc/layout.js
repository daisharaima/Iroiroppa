'use strict';

const fs = require('node:fs');
const {
  app, BrowserWindow, ipcMain, clipboard, dialog, screen, webContents,
} = require('electron');
const { migrateV1 } = require('../layout-store');
const { createCommandRouter } = require('../command-router');
const ModuleManifest = require('../../shared/module-manifest');
const { isChannel255 } = require('../ipc-sender');
const Codec = require('../../shared/layout-codec');

function register(ctx, h) {
  const { instanceOf, findInstance, moduleIdOfInstance, isSingletonModule, paletteIdForSender, commitSettings, trusted } = h;

  const explicitPath = (spec) => (
    (ctx.isDev || ctx.shotPath) && spec && typeof spec.path === 'string' && spec.path ? spec.path : null
  );

  ipcMain.handle('palette:columns:get', (event) => {
    const id = paletteIdForSender(event.sender);
    if (!id) return null;

    if (id === ctx.primaryPaletteId() && !ctx.hasStoredLayout()) return null;
    const cols = ctx.paletteColumns(id) || [];
    if (process.env.IRO_TRACE_PALCOLS) console.log('[palcols]', event.sender.id, '->', id, 'cols', JSON.stringify(cols.map((c) => (c.modules || []).map((m) => m.instanceId))));

    return { version: 1, columns: Codec.columnsToV1({ columns: cols }) };
  });
  ipcMain.on('palette:columns:set', (event, columns) => {
    if (!trusted(event)) return;
    const id = paletteIdForSender(event.sender);
    if (!id) return;
    ctx.setPaletteColumns(id, Array.isArray(columns) ? columns : []);
  });
  ipcMain.handle('layout:get', () => {

    if (!ctx.hasStoredLayout()) return null;
    const doc = ctx.readLayoutDoc();
    if (!doc) return null;
    return { version: 1, columns: doc.columns };
  });
  ipcMain.handle('layout:set', (event, layout) => {
    if (!trusted(event)) return { ok: false, error: 'untrusted sender' };
    if (!layout || !Array.isArray(layout.columns)) return { ok: false, error: 'bad-payload' };

    const doc = ctx.readLayoutDoc() || { version: 1, columns: [], floats: [] };
    if (layout && Array.isArray(layout.columns)) doc.columns = layout.columns;
    const ok = ctx.writeLayoutDoc(doc);

    if (ok) ctx.broadcastLayout();
    return ok;
  });
  ipcMain.handle('workspace:get', () => {

    const doc = ctx.readLayoutDoc();
    return { version: 1, columns: (doc && doc.columns) || [], floats: (doc && doc.floats) || [] };
  });
  ipcMain.handle('palette:duplicate', (event, paletteId) => {

    const id = paletteId || paletteIdForSender(event.sender);
    return ctx.applyLayoutIntent({ type: 'palette.duplicate', paletteId: id });
  });
  ipcMain.handle('palette:export', async (event, spec = {}) => {

    const doc = ctx.currentWorkspace();
    const palette = (doc.palettes || []).find((p) => p.id === spec.paletteId);
    if (!palette) return { ok: false, error: 'unknown-palette' };
    let target = explicitPath(spec);
    if (!target) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const safe = String(palette.name || 'palette').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'palette';
      const picked = await dialog.showSaveDialog(win, {
        title: ctx.t('dialog.exportPalette'),
        defaultPath: `${safe}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
      target = picked.filePath;
    }
    try {
      fs.writeFileSync(target, JSON.stringify({ kind: 'iroiroppa-palette', version: 2, palette }, null, 2));
      return { ok: true, path: target };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('palette:import', async (event, spec = {}) => {

    let source = explicitPath(spec);
    if (!source) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const picked = await dialog.showOpenDialog(win, {
        title: ctx.t('dialog.importPalette'),
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true };
      [source] = picked.filePaths;
    }
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(source, 'utf8'));
    } catch (err) {
      return { ok: false, error: `could not read the file: ${err.message}` };
    }
    const palette = raw && raw.palette ? raw.palette : raw;
    const out = ctx.applyLayoutIntent({ type: 'palette.import', palette });
    if (!out || out.ok === false) return out || { ok: false, error: 'the palette could not be imported' };
    return { ok: true, path: source };
  });
  ipcMain.handle('workspace:export', async (event, spec = {}) => {

    let target = explicitPath(spec);
    if (!target) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const picked = await dialog.showSaveDialog(win, {
        title: ctx.t('dialog.exportWorkspace'),
        defaultPath: 'iroiroppa-workspace.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
      target = picked.filePath;
    }
    try {
      fs.writeFileSync(target, JSON.stringify(ctx.currentWorkspace(), null, 2));
      return { ok: true, path: target };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('workspace:import', async (event, spec = {}) => {
    let source = explicitPath(spec);
    if (!source) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const picked = await dialog.showOpenDialog(win, {
        title: ctx.t('dialog.importWorkspace'),
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true };
      [source] = picked.filePaths;
    }
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(source, 'utf8'));
    } catch (err) {
      return { ok: false, error: `could not read ${source}: ${err.message}` };
    }

    const doc = raw && raw.version === 2 ? raw : migrateV1(raw, ctx.settings.get());
    const result = ctx.applyLayoutIntent({ type: 'workspace.load', doc });
    return { ...result, path: source };
  });
  ipcMain.handle('workspace:palettes', () => {

    const doc = ctx.currentWorkspace();
    return (doc.palettes || []).map((p) => ({
      id: p.id,
      name: p.name,
      collapsed: Boolean(p.collapsed),
      columns: (p.columns || []).length,
      modules: (p.columns || []).reduce((n, c) => n + (c.modules || []).length, 0),
      members: (p.columns || []).flatMap((c) => (c.modules || []).map((m) => ({
        instanceId: m.instanceId,
        moduleId: m.moduleId,
      }))),
    }));
  });

  ipcMain.handle('workspace:names', () => ctx.listNamedWorkspaces());
  ipcMain.handle('workspace:saveNamed', (_e, spec = {}) => ctx.saveNamedWorkspace(spec.name, ctx.currentWorkspace()));
  ipcMain.handle('workspace:loadNamed', (_e, spec = {}) => {
    const w = ctx.getNamedWorkspace(spec.id);
    if (!w) return { ok: false, error: 'unknown-workspace' };
    return ctx.applyLayoutIntent({ type: 'workspace.load', doc: w.doc });
  });
  ipcMain.handle('workspace:renameNamed', (_e, spec = {}) => ctx.renameNamedWorkspace(spec.id, spec.name));
  ipcMain.handle('workspace:deleteNamed', (_e, spec = {}) => ctx.deleteNamedWorkspace(spec.id));

  ipcMain.handle('settings:export', async (event, spec = {}) => {
    let target = explicitPath(spec);
    if (!target) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const picked = await dialog.showSaveDialog(win, {
        title: ctx.t('dialog.exportSettings'),
        defaultPath: 'iroiroppa-settings.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
      target = picked.filePath;
    }
    try {
      fs.writeFileSync(target, JSON.stringify({ kind: 'iroiroppa-settings', version: 1, settings: ctx.settings.get() }, null, 2));
      return { ok: true, path: target };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('settings:import', async (event, spec = {}) => {
    let source = explicitPath(spec);
    if (!source) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const picked = await dialog.showOpenDialog(win, {
        title: ctx.t('dialog.importSettings'),
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true };
      [source] = picked.filePaths;
    }
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(source, 'utf8'));
    } catch (err) {
      return { ok: false, error: `could not read ${source}: ${err.message}` };
    }
    const imported = raw && raw.settings ? raw.settings : raw;
    if (!imported || typeof imported !== 'object') return { ok: false, error: 'not a settings file' };
    const next = commitSettings(imported);
    return { ok: true, settings: next, path: source };
  });

  ipcMain.handle('module:add', (_e, spec = {}) => {
    const moduleId = spec && typeof spec.moduleId === 'string' ? spec.moduleId : null;
    if (!moduleId) return { ok: false, error: 'bad-module' };
    return ctx.applyLayoutIntent({ type: 'module.enable', moduleId, lone: true });
  });
  ipcMain.handle('module:setHeight', (_e, spec = {}) => {

    const instanceId = instanceOf(spec);
    if (!instanceId) return { ok: false, error: 'bad-instance' };
    return ctx.applyLayoutIntent({ type: 'module.setHeight', instanceId, height: spec.height });
  });
  ipcMain.handle('module:setCollapsed', (_e, spec = {}) => {

    const instanceId = instanceOf(spec);
    if (!instanceId) return { ok: false, error: 'bad-instance' };
    return ctx.applyLayoutIntent({ type: 'module.setCollapsed', instanceId, collapsed: spec.collapsed === true });
  });
  ipcMain.handle('module:duplicate', (_e, spec = {}) => {
    const instanceId = instanceOf(spec);
    const found = instanceId ? findInstance(instanceId) : null;
    if (!found) return { ok: false, error: 'unknown-instance' };

    const copyId = ctx.mintInstanceId('i');
    const out = ctx.applyLayoutIntent({ type: 'module.enable', moduleId: found.moduleId, instanceId: copyId, lone: true });
    if (!out || !out.ok) return out;
    const settingsCopied = found.hidden ? false : ctx.moduleStore.copySettings(instanceId, copyId, found.moduleId);
    return { ...out, instanceId: copyId, settingsCopied };
  });
  ipcMain.handle('module:hide', (_e, spec = {}) => ctx.applyLayoutIntent({ type: 'module.hide', instanceId: instanceOf(spec) }));
  ipcMain.handle('module:show', (_e, spec = {}) => ctx.applyLayoutIntent({ type: 'module.show', instanceId: instanceOf(spec), lone: true }));
  ipcMain.handle('module:remove', (_e, spec = {}) => {
    const instanceId = instanceOf(spec);

    if (isSingletonModule(moduleIdOfInstance(instanceId))) {
      return { ok: false, error: 'that module is a singleton — hide it instead of deleting it' };
    }
    return ctx.applyLayoutIntent({ type: 'module.remove', instanceId });
  });
  ipcMain.handle('workspace:hidden', () => ctx.currentWorkspace().hiddenInstances || []);
  ipcMain.handle('floats:list', () => {
    const doc = ctx.readLayoutDoc();
    return (doc && doc.floats) || [];
  });
  ipcMain.handle('palette:state:get', (event) => {

    const paletteId = paletteIdForSender(event.sender);
    const palette = paletteId ? ctx.layoutPalette(paletteId) : null;
    if (!palette) return null;
    return {
      id: palette.id,
      name: palette.name,
      collapsed: Boolean(palette.collapsed),

      attached: Boolean(palette.snap && palette.snapTo),

      snap: palette.snap || null,
      snapTo: palette.snapTo || null,

      hasFollowers: (ctx.currentWorkspace().palettes || []).some((p) => p.snap && p.snapTo === palette.id),
    };
  });
  ipcMain.handle('palette:unsnap', (event) => {
    const paletteId = paletteIdForSender(event.sender);
    if (!paletteId) return { ok: false, error: 'unknown-window' };

    const doc = ctx.currentWorkspace();
    const palette = (doc.palettes || []).find((p) => p.id === paletteId);
    if (!palette) return { ok: false, error: 'unknown-palette' };
    const followers = (doc.palettes || []).filter((p) => p.snap && p.snapTo === paletteId);
    if (palette.snap) {
      const result = ctx.applyLayoutIntent({ type: 'palette.setSnap', paletteId, snap: null });
      return { ok: Boolean(result && result.ok), error: result && result.error };
    }
    if (!followers.length) return { ok: true, noop: true };
    let ok = true;
    for (const follower of followers) {
      const result = ctx.applyLayoutIntent({ type: 'palette.setSnap', paletteId: follower.id, snap: null });
      if (!result || result.ok === false) ok = false;
    }
    return { ok };
  });
  ipcMain.handle('palette:delete', (event, spec = {}) => {

    const paletteId = (spec && typeof spec.paletteId === 'string' && spec.paletteId)
      || paletteIdForSender(event.sender);
    if (!paletteId) return { ok: false, error: 'unknown-window' };
    const result = ctx.applyLayoutIntent({ type: 'palette.remove', paletteId });
    return { ok: Boolean(result && result.ok), error: result && result.error };
  });
  ipcMain.handle('palette:rename', (event, spec = {}) => {

    const own = paletteIdForSender(event.sender);
    const paletteId = typeof spec === 'string' ? own : (spec.paletteId || own);
    const name = typeof spec === 'string' ? spec : spec.name;
    if (!paletteId) return { ok: false, error: 'unknown-window' };

    const result = ctx.applyLayoutIntent({ type: 'palette.rename', paletteId, name });
    return { ok: Boolean(result && result.ok), error: result && result.error };
  });

}

module.exports = { register };

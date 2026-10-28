'use strict';

// The layout IPC group (docs/STATE.md).
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
const Codec = require('../../shared/layout-codec');

function register(ctx, h) {
  const { instanceOf, findInstance, moduleIdOfInstance, isSingletonModule, paletteIdForSender, commitSettings, trusted } = h;  // A window's own palette columns (plan: palette equality, P3). The palette id comes
  // from the *sender*, never the payload, so a window can only read/write itself.
  // A quiet save/open path is a dev/`--shot` affordance: in production the dialog
  // picks the file, so a renderer can never name one to write over
  // (docs/STATE.md, privileged channels).
  const explicitPath = (spec) => (
    (ctx.isDev || ctx.shotPath) && spec && typeof spec.path === 'string' && spec.path ? spec.path : null
  );

  ipcMain.handle('palette:columns:get', (event) => {
    const id = paletteIdForSender(event.sender);
    if (!id) return null;
    // A first run leaves the *palette* window to seed its own default layout; a float is
    // always a palette that already exists, so it gets its real columns (a fresh run used
    // to render it empty in legacy mode).
    if (id === ctx.primaryPaletteId() && !ctx.hasStoredLayout()) return null;
    const cols = ctx.paletteColumns(id) || [];
    if (process.env.IRO_TRACE_PALCOLS) console.log('[palcols]', event.sender.id, '->', id, 'cols', JSON.stringify(cols.map((c) => (c.modules || []).map((m) => m.instanceId))));
    // v1 columns (the board's contract): the codec runs here in main.
    return { version: 1, columns: Codec.columnsToV1({ columns: cols }) };
  });
  ipcMain.on('palette:columns:set', (event, columns) => {
    if (!trusted(event)) return;
    const id = paletteIdForSender(event.sender);
    if (!id) return;
    ctx.setPaletteColumns(id, Array.isArray(columns) ? columns : []);
  });
  ipcMain.handle('layout:get', () => {
    // Null (rather than an empty board) so the renderer uses its default layout
    // on first run.
    if (!ctx.hasStoredLayout()) return null;
    const doc = ctx.readLayoutDoc();
    if (!doc) return null;
    return { version: 1, columns: doc.columns };
  });
  ipcMain.handle('layout:set', (event, layout) => {
    if (!trusted(event)) return { ok: false, error: 'untrusted sender' };
    if (!layout || !Array.isArray(layout.columns)) return { ok: false, error: 'bad-payload' };
    // The palette owns the columns; main owns the float entries, so only the
    // columns are replaced here (a floated module is never clobbered).
    const doc = ctx.readLayoutDoc() || { version: 1, columns: [], floats: [] };
    if (layout && Array.isArray(layout.columns)) doc.columns = layout.columns;
    const ok = ctx.writeLayoutDoc(doc);
    // A legacy writer (anything still on `/layout:set`) must reach the canonical model too: the
    // palette in `model` state mode ignores the legacy channel, which is what made the old
    // Settings toggle change the document but not the palette on screen. Broadcast through the
    // one path so every window and `stateHub` see the same document.
    if (ok) ctx.broadcastLayout();
    return ok;
  });
  ipcMain.handle('workspace:get', () => {
    // The *live* document as the v1 view: never null, unlike `layout:get`, which
    // stays null on a first run so the board builds its default. The Settings
    // window needs the live columns to know which instances exist (N1).
    const doc = ctx.readLayoutDoc();
    return { version: 1, columns: (doc && doc.columns) || [], floats: (doc && doc.floats) || [] };
  });
  ipcMain.handle('palette:duplicate', (event, paletteId) => {
    // Duplicate a palette (docs/LAYOUT.md, N3). The copy keeps the module *ids* but
    // gets new instances, so its modules have their own settings (N1).
    const id = paletteId || paletteIdForSender(event.sender);
    return ctx.applyLayoutIntent({ type: 'palette.duplicate', paletteId: id });
  });
  ipcMain.handle('palette:export', async (event, spec = {}) => {
    // Export one palette (Settings → Layout): just that palette, with its instances.
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
    // Import one palette: a palette as exported above, or a bare palette object. Its
    // ids are re-minted by the reducer, so it never collides with what is here.
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
    // The workspace is exactly the document. A caller may name the path (the dev flag
    // and tests do); otherwise the user picks one.
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
    // A v1 file (an old layout.json) is migrated on the way in: importing means
    // "anything this app has ever written".
    const doc = raw && raw.version === 2 ? raw : migrateV1(raw, ctx.settings.get());
    const result = ctx.applyLayoutIntent({ type: 'workspace.load', doc });
    return { ...result, path: source };
  });
  ipcMain.handle('workspace:palettes', () => {
    // What the Layout tab lists: every palette, with what it holds (docs/LAYOUT.md,
    // N3). Read from the document, not the v1 view, so the names are the names.
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
  // --- named saved workspaces (Settings → Layout) ------------------------------
  ipcMain.handle('workspace:names', () => ctx.listNamedWorkspaces());
  ipcMain.handle('workspace:saveNamed', (_e, spec = {}) => ctx.saveNamedWorkspace(spec.name, ctx.currentWorkspace()));
  ipcMain.handle('workspace:loadNamed', (_e, spec = {}) => {
    const w = ctx.getNamedWorkspace(spec.id);
    if (!w) return { ok: false, error: 'unknown-workspace' };
    return ctx.applyLayoutIntent({ type: 'workspace.load', doc: w.doc });
  });
  ipcMain.handle('workspace:renameNamed', (_e, spec = {}) => ctx.renameNamedWorkspace(spec.id, spec.name));
  ipcMain.handle('workspace:deleteNamed', (_e, spec = {}) => ctx.deleteNamedWorkspace(spec.id));
  // --- settings export / import (Settings → General) ---------------------------
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
  // --- instance controls (Settings → Modules): add, duplicate, delete, hide ----------
  ipcMain.handle('module:add', (_e, spec = {}) => {
    const moduleId = spec && typeof spec.moduleId === 'string' ? spec.moduleId : null;
    if (!moduleId) return { ok: false, error: 'bad-module' };
    return ctx.applyLayoutIntent({ type: 'module.enable', moduleId, lone: true });
  });
  ipcMain.handle('module:setHeight', (_e, spec = {}) => {
    // The Module Size slider: a per-instance height, e.g. { mode: 'ratio', ratio }.
    const instanceId = instanceOf(spec);
    if (!instanceId) return { ok: false, error: 'bad-instance' };
    return ctx.applyLayoutIntent({ type: 'module.setHeight', instanceId, height: spec.height });
  });
  ipcMain.handle('module:setCollapsed', (_e, spec = {}) => {
    // Minimize/expand one module card. The board owns the render; this is the
    // one writer for the document's `collapsed` flag.
    const instanceId = instanceOf(spec);
    if (!instanceId) return { ok: false, error: 'bad-instance' };
    return ctx.applyLayoutIntent({ type: 'module.setCollapsed', instanceId, collapsed: spec.collapsed === true });
  });
  ipcMain.handle('module:duplicate', (_e, spec = {}) => {
    const instanceId = instanceOf(spec);
    const found = instanceId ? findInstance(instanceId) : null;
    if (!found) return { ok: false, error: 'unknown-instance' };
    // The id is minted first (still main-generated) so the source's settings can be copied
    // onto the new instance before it is mounted.
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
    // A **singleton** is never deleted, only hidden. The check lives here, in main, rather than in
    // the UI that asks: the popout's Delete, the Settings tab's Delete and every future path go
    // through this one handler, so a singleton cannot be thrown away by a control I forget to guard.
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
    // A fresh window asks on boot rather than being pushed to: a push can arrive
    // before its board exists (the same reason `palette:state:get` exists).
    const paletteId = paletteIdForSender(event.sender);
    const palette = paletteId ? ctx.layoutPalette(paletteId) : null;
    if (!palette) return null;
    return {
      id: palette.id,
      name: palette.name,
      collapsed: Boolean(palette.collapsed),
      // In a snap group (docs/LAYOUT.md, "Snap zones"). A lone module shows its palette
      // container when it is, so its container can be dragged as a window and the module by
      // its own header.
      attached: Boolean(palette.snap && palette.snapTo),
      // Which way it is joined, so the palette menu can offer Unsnap only when there is a join.
      snap: palette.snap || null,
      snapTo: palette.snapTo || null,
      // The titlebar's Unsnap icon: an anchor has followers but no `snap` of its own, and the
      // group's anchor must be able to release the group too.
      hasFollowers: (ctx.currentWorkspace().palettes || []).some((p) => p.snap && p.snapTo === palette.id),
    };
  });
  ipcMain.handle('palette:unsnap', (event) => {
    const paletteId = paletteIdForSender(event.sender);
    if (!paletteId) return { ok: false, error: 'unknown-window' };
    // A follower detaches itself; an anchor comes free by releasing every direct follower.
    // Both are the same intent, so the document — not a window — stays the truth.
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
    // Delete a palette and everything in it: the caller's own window by default (the
    // palette menu), or any palette by id (Settings → Layout). The last palette is
    // refused by the reducer with `last-palette`.
    const paletteId = (spec && typeof spec.paletteId === 'string' && spec.paletteId)
      || paletteIdForSender(event.sender);
    if (!paletteId) return { ok: false, error: 'unknown-window' };
    const result = ctx.applyLayoutIntent({ type: 'palette.remove', paletteId });
    return { ok: Boolean(result && result.ok), error: result && result.error };
  });
  ipcMain.handle('palette:rename', (event, spec = {}) => {
    // Rename a palette: the caller's own window by default (the titlebar field sends a
    // bare name), or any palette by id (the Settings → Layout list, N3). Always
    // answers `{ ok }` so both callers can tell a refusal from a success.
    const own = paletteIdForSender(event.sender);
    const paletteId = typeof spec === 'string' ? own : (spec.paletteId || own);
    const name = typeof spec === 'string' ? spec : spec.name;
    if (!paletteId) return { ok: false, error: 'unknown-window' };
    // Through the one intent path, not a bare dispatch: every window (and the state
    // domain) must learn the new name, so a Settings rename reaches the titlebar too.
    const result = ctx.applyLayoutIntent({ type: 'palette.rename', paletteId, name });
    return { ok: Boolean(result && result.ok), error: result && result.error };
  });

}

module.exports = { register };

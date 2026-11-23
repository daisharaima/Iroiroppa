'use strict';

const fs = require('node:fs');
const {
  app, BrowserWindow, ipcMain, clipboard, dialog, screen, webContents,
} = require('electron');
const { migrateV1 } = require('../layout-store');
const { createCommandRouter } = require('../command-router');
const ModuleManifest = require('../../shared/module-manifest');
const ShortcutModel = require('../../shared/shortcut-model');
const { sendTo } = require('../broadcast');
const { isChannel255 } = require('../ipc-sender');

function register(ctx, h) {
  const { instanceOf, findInstance, moduleIdOfInstance, isSingletonModule, paletteIdForSender, commitSettings, trusted } = h;  ipcMain.on('module:action', (_e, payload) => {

    for (const win of ctx.paletteWindows()) sendTo(win, 'module:action', payload);
  });

  const commandRouter = createCommandRouter({
    send: (wcId, channel, payload) => {
      const wc = webContents.fromId(wcId);
      if (wc && !wc.isDestroyed()) wc.send(channel, payload);
    },
  });

  ctx.commandRouter = commandRouter;
  const commandWindows = new Set();
  ipcMain.on('module:command:register', (event, table) => {
    const wcId = event.sender.id;
    commandRouter.register(wcId, table);
    if (!commandWindows.has(wcId)) {
      commandWindows.add(wcId);
      event.sender.once('destroyed', () => {
        commandWindows.delete(wcId);
        commandRouter.unregister(wcId);
      });
    }
  });
  ipcMain.handle('module:command:call', (_e, spec) => commandRouter.call(spec || {}));
  ipcMain.on('module:command:result', (event, result) => commandRouter.settle(result || {}, event.sender.id));
  ipcMain.handle('module:commands:list', () => commandRouter.list());

  ipcMain.handle('shortcut:setSummon', (_e, accel) => setShowShortcutGuarded({ target: 'app', action: 'toggle', accel }));

  function cspRefusal(accel) {
    const owner = ctx.cspAccelOwner ? ctx.cspAccelOwner(accel) : null;
    if (!owner) return null;
    return {
      ok: false,
      error: 'csp-conflict',
      conflictWith: owner.label,
      conflictKind: owner.kind,
      message: `${owner.label} already uses that shortcut in Clip Studio Paint`,
    };
  }

  function setShowShortcutGuarded(spec) {
    const accel = spec && spec.accel;
    const refused = accel ? cspRefusal(accel) : null;
    if (refused) return refused;
    return ctx.setShowShortcut(spec);
  }

  ipcMain.handle('shortcut:set', (_e, spec = {}) => setShowShortcutGuarded(spec));
  ipcMain.handle('shortcut:setOption', (_e, spec = {}) => ctx.setShortcutOption(spec));
  ipcMain.handle('shortcut:setAltClick', (_e, spec = {}) => ctx.setAltClickTarget(spec.target));

  ipcMain.handle('shortcut:catalog', () => {
    const list = commandRouter.list();
    const moduleOf = new Map();
    const doc = ctx.currentWorkspace();
    for (const p of (doc && doc.palettes) || []) {
      for (const c of p.columns || []) {
        for (const m of c.modules || []) moduleOf.set(m.instanceId, m.moduleId);
      }
    }
    for (const h of (doc && doc.hiddenInstances) || []) {
      if (h && h.instanceId) moduleOf.set(h.instanceId, h.moduleId);
    }
    const bindings = ctx.settings.get().commandBindings || {};
    const out = [];
    for (const [instanceId, commands] of Object.entries(list)) {
      const moduleId = moduleOf.get(instanceId) || '';
      const def = ModuleManifest.get(moduleId);
      for (const command of commands) {
        const key = `${instanceId}:${command}`;
        out.push({
          instanceId, moduleId, name: def ? def.name : moduleId, command,
          binding: bindings[key] || '', hidden: false,
        });
      }
    }

    for (const [instanceId, moduleId] of moduleOf) {
      if (list[instanceId]) continue;
      for (const [key, binding] of Object.entries(bindings)) {
        if (!key.startsWith(`${instanceId}:`)) continue;
        const def = ModuleManifest.get(moduleId);
        out.push({
          instanceId, moduleId, name: def ? def.name : moduleId,
          command: key.slice(instanceId.length + 1), binding, hidden: true,
        });
      }
    }
    out.sort((a, b) => `${a.name} ${a.command}`.localeCompare(`${b.name} ${b.command}`));
    const shortcuts = ShortcutModel.normalise(ctx.settings.get().shortcuts);
    return {
      commands: out,
      app: shortcuts.app,
      palettes: shortcuts.palettes,
      autoHide: ctx.settings.get().autoHide !== false,
      active: typeof ctx.isShortcutActive === 'function' ? ctx.isShortcutActive() : true,
      summonHotkey: shortcuts.app.toggle,
    };
  });

  ipcMain.handle('shortcut:setBinding', (_e, { key, accel } = {}) => {
    const k = String(key || '').trim();
    if (!k || k.indexOf(':') === -1) return { ok: false, failures: [{ key: k, error: 'invalid' }] };
    const a0 = String(accel || '').trim();
    const refused = a0 ? cspRefusal(a0) : null;
    if (refused) {
      return {
        ok: false,
        failures: [{ key: k, error: 'csp-conflict' }],
        conflictWith: refused.conflictWith,
        conflictKind: refused.conflictKind,
        message: refused.message,
      };
    }
    const current = { ...(ctx.settings.get().commandBindings || {}) };
    const trial = { ...current };
    const a = String(accel || '').trim();
    if (a) trial[k] = a; else delete trial[k];
    if (a) {
      const clash = ShortcutModel.findConflict(
        a, ctx.settings.get().shortcuts, trial, `command:${k}`,
      );
      if (clash) return { ok: false, failures: [{ key: k, error: 'conflict' }], conflictWith: clash.key };
    }
    const res = ctx.applyCommandHotkeys(trial);
    if (a && res.failures.some((f) => f.key === k)) {
      ctx.applyCommandHotkeys(current);
      return { ok: false, failures: res.failures.filter((f) => f.key === k) };
    }
    ctx.settings.set({ commandBindings: trial });
    return { ok: true, registered: res.registered, failures: res.failures };
  });

}

module.exports = { register };

'use strict';

// The commands IPC group (docs/STATE.md).
//
// Moved out of ipc.js verbatim; `wireIpc` hands it `ctx` and the shared helpers `h`.

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
    // Every palette shows the action (a module command can be bound in any of them).
    for (const win of ctx.paletteWindows()) sendTo(win, 'module:action', payload);
  });

  // --- module command bus (docs/MODULES.md, "Module commands") ----------------
  // Main owns the registry so a command reaches the window that mounts the target
  // instance, whether that is the palette or a float. A call awaits the target's
  // reply (correlated by callId) with a timeout.
  const commandRouter = createCommandRouter({
    send: (wcId, channel, payload) => {
      const wc = webContents.fromId(wcId);
      if (wc && !wc.isDestroyed()) wc.send(channel, payload);
    },
  });
  // windows.js's per-module hotkeys call through this (ctx.commandRouter is resolved lazily,
  // so the creation order between windows and IPC does not matter).
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

  // The summon hotkey (docs/DEV.md). Register first; only persist when it took,
  // so a key another app already owns is not remembered as if it worked.
  ipcMain.handle('shortcut:setSummon', (_e, accel) => ctx.setShowShortcut({ target: 'app', action: 'toggle', accel }));

  // The unified General/Palette binding editor (Settings → Shortcuts).
  ipcMain.handle('shortcut:set', (_e, spec = {}) => ctx.setShowShortcut(spec));
  ipcMain.handle('shortcut:setOption', (_e, spec = {}) => ctx.setShortcutOption(spec));
  ipcMain.handle('shortcut:setAltClick', (_e, spec = {}) => ctx.setAltClickTarget(spec.target));

  // The commands a Settings hotkey can bind, named for a human: every mounted
  // instance's module name plus its command, resolved from the workspace document.
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
    // A hidden instance has no live command table, but a saved binding for it is
    // still a real shortcut and must be visible (and clearable) in the manager.
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

  // Bind (or clear) one `<instanceId>:<command>` hotkey. Register first; only persist
  // when it took, and restore the previous set when it did not.
  ipcMain.handle('shortcut:setBinding', (_e, { key, accel } = {}) => {
    const k = String(key || '').trim();
    if (!k || k.indexOf(':') === -1) return { ok: false, failures: [{ key: k, error: 'invalid' }] };
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

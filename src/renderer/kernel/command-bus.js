'use strict';

(function () {
  const local = new Map();

  let syncTimer = null;

  /** Tell main which instances (and command names) this window now mounts. */
  function sync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      const table = {};
      for (const [instanceId, entry] of local) table[instanceId] = Object.keys(entry.commands);
      try { window.csp.commandRegister(table); } catch {  }
    }, 60);
  }

  /** Register an instance's commands (called by ModuleHost after `create`). */
  function registerLocal(instanceId, commands) {
    if (!instanceId || !commands) return;
    const table = {};
    for (const [name, fn] of Object.entries(commands)) {
      if (typeof fn === 'function') table[name] = fn;
    }
    local.set(instanceId, { commands: table });
    sync();
  }

  /** Forget an instance (its module was torn down). */
  function unregisterLocal(instanceId) {
    if (local.delete(instanceId)) sync();
  }

  function asArgs(args) {
    if (args === undefined) return [];
    return Array.isArray(args) ? args : [args];
  }

  function invokeLocal(entry, command, args) {
    const fn = entry.commands[command];
    if (typeof fn !== 'function') throw new Error(`unknown command "${command}"`);

    return Promise.resolve().then(() => fn(...asArgs(args)));
  }

  /**
   * Call a command on an instance. Runs locally when this window mounts the
   * instance, otherwise relays through main.
   */
  async function call(target, command, args) {
    const entry = local.get(target);
    if (entry) return invokeLocal(entry, command, args);
    return window.csp.commandCall(target, command, args);
  }

  /** Every command name across every window, as `{ instanceId: [name, …] }`. */
  async function list() {
    try { return (await window.csp.listCommands()) || {}; } catch { return {}; }
  }

  /** Run a relayed call from another window and post the result back to main. */
  async function handleInvoke({ callId, target, command, args } = {}) {
    const entry = local.get(target);
    try {
      if (!entry) throw new Error(`no instance "${target}" in this window`);
      const value = await invokeLocal(entry, command, args);
      window.csp.commandResult(callId, true, value, null);
    } catch (err) {
      window.csp.commandResult(callId, false, null, String((err && err.message) || err));
    }
  }

  if (window.csp && typeof window.csp.onCommandInvoke === 'function') {
    window.csp.onCommandInvoke((payload) => { handleInvoke(payload); });
  }

  window.Iro = window.Iro || {};
  window.Iro.commands = { registerLocal, unregisterLocal, call, list, handleInvoke };
})();

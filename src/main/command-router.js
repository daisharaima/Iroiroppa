'use strict';

// Routes a module command from the calling window to the window that mounts the
// target instance, and correlates the async reply (docs/MODULES.md, "Module
// commands"). It is deliberately free of Electron: `send(wcId, channel, payload)`
// is injected and windows are identified by an opaque id, so the routing and the
// correlation are unit-testable (test/command-router.test.js).
//
// Main owns the registry because the app is multi-window: a command issued in the
// palette must reach a target mounted in a float, and only main knows which
// window holds which instance.

/**
 * @param {object} opts
 * @param {(wcId: number, channel: string, payload: object) => void} opts.send
 * @param {number} [opts.timeoutMs] how long a call waits for the target's reply
 */
function createCommandRouter({ send, timeoutMs = 5000 } = {}) {
  const byInstance = new Map(); // instanceId -> wcId
  const byWindow = new Map();   // wcId -> Set<instanceId>
  const names = new Map();      // instanceId -> [commandName, ...]
  const pending = new Map();    // callId -> { resolve, reject, timer }
  let seq = 0;

  /**
   * Replace everything a window declares it mounts. `table` is
   * `{ instanceId: [commandName, ...] }`; an instance with no commands is still
   * worth registering (its window is reachable) but contributes no names.
   */
  function register(wcId, table = {}) {
    unregister(wcId);
    const set = new Set();
    for (const [instanceId, list] of Object.entries(table || {})) {
      if (!instanceId) continue;
      byInstance.set(instanceId, wcId);
      names.set(instanceId, Array.isArray(list) ? list.slice() : []);
      set.add(instanceId);
    }
    byWindow.set(wcId, set);
  }

  /** Forget a window's instances (its renderer is gone or it rebuilt). */
  function unregister(wcId) {
    const set = byWindow.get(wcId);
    if (!set) return;
    for (const instanceId of set) {
      // Only drop what this window still owns: another window may have re-registered
      // the instance since, and a stale unregister must not delete the live owner.
      if (byInstance.get(instanceId) !== wcId) continue;
      byInstance.delete(instanceId);
      names.delete(instanceId);
    }
    byWindow.delete(wcId);
  }

  /** The full `{ instanceId: [commandName, ...] }` map, across every window. */
  function list() {
    const out = {};
    for (const [instanceId, cmds] of names) out[instanceId] = cmds.slice();
    return out;
  }

  /** Call a command on an instance, wherever it is mounted. */
  function call({ target, command, args } = {}) {
    const wcId = byInstance.get(target);
    if (wcId == null) return Promise.reject(new Error(`no window mounts "${target}"`));
    const callId = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(callId);
        reject(new Error(`command "${command}" on "${target}" timed out`));
      }, timeoutMs);
      pending.set(callId, { resolve, reject, timer, wcId });
      send(wcId, 'module:command:invoke', { callId, target, command, args });
    });
  }

  /**
   * Settle a pending call from a target's reply. Returns whether it matched.
   * `fromWcId` is the replier: a call may only be settled by the window it was sent
   * to, so one window cannot forge another's replies (call ids are small integers).
   */
  function settle({ callId, ok, value, error } = {}, fromWcId) {
    const p = pending.get(callId);
    if (!p) return false;
    if (fromWcId != null && p.wcId != null && p.wcId !== fromWcId) return false;
    pending.delete(callId);
    clearTimeout(p.timer);
    if (ok) p.resolve(value);
    else p.reject(new Error(error || 'command failed'));
    return true;
  }

  return { register, unregister, list, call, settle, _pending: pending };
}

module.exports = { createCommandRouter };

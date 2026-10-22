'use strict';

// The compute host (docs/STATE.md, §6).
//
// A supervised utilityProcess that runs work off the main thread, so a hung child
// or a slow QR decode cannot stall the UI. It is stateless — the worker owns no
// state — and every request is correlated by id with its own timeout. Electron is
// only needed for the default `fork`, which is injected, so the supervisor is
// unit-tested (test/compute-host.test.js).

const Compute = require('../shared/compute-protocol');

/**
 * @param {object} opts
 * @param {string} opts.workerPath absolute path to the worker entry
 * @param {Function} [opts.fork] `utilityProcess.fork` (injected)
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.serviceName]
 */
function createComputeHost({ workerPath, fork, timeoutMs = 15000, serviceName = 'iroiroppa-compute', onEvent } = {}) {
  let child = null;
  const pending = new Map(); // id -> { resolve, reject, timer }
  let seq = 0;

  function ensure() {
    if (child) return child;
    const forkFn = fork || require('electron').utilityProcess.fork;
    child = forkFn(workerPath, [], { serviceName, stdio: 'ignore' });
    if (typeof onEvent === 'function') onEvent('up', { pid: child.pid });
    child.on('message', (message) => {
      if (!Compute.isReply(message)) return;
      const p = pending.get(message.id);
      if (!p) return;
      pending.delete(message.id);
      clearTimeout(p.timer);
      if (message.ok) p.resolve(message.value);
      else p.reject(new Error(message.error || 'compute failed'));
    });
    child.on('exit', (code) => {
      child = null;
      if (typeof onEvent === 'function') onEvent('down', { code });
      for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('compute host exited')); }
      pending.clear();
    });
    return child;
  }

  /** Send a request and resolve with the worker's reply value. */
  function request(type, payload, opts = {}) {
    const c = ensure();
    const id = ++seq;
    const timeout = opts.timeoutMs || timeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`compute "${type}" timed out`));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      c.postMessage(Compute.createRequest(id, type, payload));
    });
  }

  function dispose() {
    const p = child;
    child = null;
    if (p) { try { p.kill(); } catch { /* already gone */ } }
    for (const [, e] of pending) { clearTimeout(e.timer); e.reject(new Error('compute host disposed')); }
    pending.clear();
  }

  return { request, dispose, isRunning: () => Boolean(child), _pending: pending };
}

module.exports = { createComputeHost };

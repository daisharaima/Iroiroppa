'use strict';

// The canonical state model (docs/STATE.md, §4.3). Main is the sole writer and
// every window mirrors it. Deliberately free of Electron — `emit` is injected —
// so the revision/emit behaviour is unit-tested headlessly
// (test/state-hub.test.js), the same pattern as command-router.js.

const StateDomains = require('../shared/state-domains');

/**
 * @param {object} opts
 * @param {(channel: string, payload: object) => void} opts.emit
 * @param {object} [opts.domains] defaults to the shared registry
 */
function createStateHub({ emit, domains = StateDomains } = {}) {
  const store = new Map();   // id -> { rev, value }
  const listeners = new Set();

  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /**
   * Write a domain. Returns whether it changed. An invalid value (a malformed
   * token payload, or a non-serialisable opaque value) is ignored, and an
   * unchanged value does not bump the revision or emit — so a redundant write
   * never wakes every window.
   */
  function set(domain, value) {
    const norm = domains.normalize(domain, value);
    if (!norm.ok) return false;
    const prev = store.get(domain);
    if (prev && equal(prev.value, norm.value)) return false;
    const rev = (prev ? prev.rev : 0) + 1;
    store.set(domain, { rev, value: norm.value });
    const change = { domain, rev, value: norm.value };
    // A broadcast must never abort the state update (docs/INVARIANTS.md).
    if (typeof emit === 'function') { try { emit('state:changed', change); } catch { /* keep going */ } }
    for (const fn of listeners) { try { fn(change); } catch { /* keep going */ } }
    return true;
  }

  const get = (domain) => {
    const e = store.get(domain);
    return e ? { rev: e.rev, value: e.value } : null;
  };

  /** The full `{ version, domains }` envelope. */
  function snapshot() {
    const domainsOut = {};
    for (const [id, e] of store) domainsOut[id] = { rev: e.rev, value: e.value };
    return { version: 1, domains: domainsOut };
  }

  function on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { set, get, snapshot, on, domains: () => [...store.keys()], size: () => store.size };
}

module.exports = { createStateHub };

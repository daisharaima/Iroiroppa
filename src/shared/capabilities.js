
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroCapabilities = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CHANNELS = ['companion', 'capture', 'sender', 'stub'];

  /** One adapter per channel; `available`/`reason` are live. */
  function createCapabilities({ channels = {} } = {}) {
    const adapters = new Map();
    const listeners = new Set();

    const normalise = (id, a) => ({
      id,
      label: (a && a.label) || id,
      available: Boolean(a && a.available),
      reason: (a && a.reason) || '',
    });

    /** Register or replace a channel adapter. */
    function register(id, adapter) { adapters.set(id, normalise(id, adapter)); }

    for (const [id, adapter] of Object.entries(channels)) register(id, adapter);

    /** The live set: `{ <id>: { id, label, available, reason } }`. */
    function state() {
      const out = {};
      for (const [id, a] of adapters) out[id] = { ...a };
      return out;
    }

    const get = (id) => (adapters.has(id) ? { ...adapters.get(id) } : null);

    /** Update one channel; emits only when `available` or `reason` changed. */
    function set(id, change) {
      const prev = adapters.get(id);
      if (!prev || !change) return false;
      const next = normalise(id, { ...prev, ...change });
      if (prev.available === next.available && prev.reason === next.reason) return false;
      adapters.set(id, next);
      const snapshot = state();
      for (const fn of listeners) { try { fn(snapshot); } catch {  } }
      return true;
    }

    function on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    return { CHANNELS, register, get, set, state, on, ids: () => [...adapters.keys()] };
  }

  /**
   * What a module's declared capabilities mean against a live set.
   * `def.capabilities` is `{ <channel>: 'required' | 'optional' }`.
   * Returns `{ ok, unavailable, missingRequired, missingOptional }`, where
   * `unavailable` is a UI-ready reason string (empty when the module is usable).
   */
  function availability(def, state) {
    const needs = (def && def.capabilities) || {};
    const missingRequired = [];
    const missingOptional = [];
    for (const [channel, kind] of Object.entries(needs)) {
      const cap = state && state[channel];
      if (cap && cap.available) continue;
      const reason = (cap && cap.reason) || 'not available';
      if (kind === 'optional') missingOptional.push({ channel, reason });
      else missingRequired.push({ channel, reason });
    }
    const ok = missingRequired.length === 0;
    const first = missingRequired[0];
    const unavailable = ok
      ? ''
      : `${first.channel} unavailable${first.reason ? ` — ${first.reason}` : ''}`;
    return { ok, unavailable, missingRequired, missingOptional };
  }

  return { CHANNELS, createCapabilities, availability };
});

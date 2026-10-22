/*
 * The capability model (docs/ARCHITECTURE.md).
 *
 * The app reaches Clip Studio Paint over more than one channel — the Companion
 * protocol, a live window capture, native senders — and a selector module may
 * use any combination of them, each as *required* or *optional*. This file is
 * the pure model of that: the live set of channels and the availability a module
 * derives from it. Main owns the set; every window mirrors it (the protocol can
 * drop mid-session, so it is live state, never a boot-time probe).
 *
 * Loads as CommonJS in Node and as a global `IroCapabilities` in the renderer,
 * like module-manifest.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroCapabilities = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The channels a module may declare. `stub` is always available: it makes a
  // two-channel module testable (and `--shot`-renderable) with only one.
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
      for (const fn of listeners) { try { fn(snapshot); } catch { /* keep going */ } }
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

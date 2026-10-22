'use strict';

// The renderer's mirror of main's live capability set.
// The pure model is shared/capabilities.js; this holds the state, follows
// `capabilities:changed`, and hands a module both the set and its own
// availability. A module may `on(fn)` to switch source when a channel moves.

(function () {
  const csp = window.csp;
  const Model = window.IroCapabilities;

  function createCapabilityStore() {
    let state = {};
    const listeners = new Set();

    function set(next) {
      state = next || {};
      for (const fn of listeners) { try { fn(state); } catch { /* keep going */ } }
    }

    const get = (id) => state[id] || null;
    const snapshot = () => ({ ...state });
    function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    async function refresh() {
      try { set(await csp.capabilities()); } catch { /* stay on the last set */ }
    }

    // In `model` mode the state adapter drives `set`; the legacy channel would be
    // a second, hand-mirrored source (docs/STATE.md, §12.2).
    if (csp && csp.stateMode !== 'model' && typeof csp.onCapabilities === 'function') {
      csp.onCapabilities((s) => set(s));
    }

    return {
      state: snapshot,
      get,
      on,
      set,
      refresh,
      /** Whether a module (its def) can run against the current set. */
      availability: (def) => Model.availability(def, state),
    };
  }

  window.Iro = window.Iro || {};
  window.Iro.createCapabilityStore = createCapabilityStore;
})();

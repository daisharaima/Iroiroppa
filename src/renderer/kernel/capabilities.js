'use strict';

(function () {
  const csp = window.csp;
  const Model = window.IroCapabilities;

  function createCapabilityStore() {
    let state = {};
    const listeners = new Set();

    function set(next) {
      state = next || {};
      for (const fn of listeners) { try { fn(state); } catch {  } }
    }

    const get = (id) => state[id] || null;
    const snapshot = () => ({ ...state });
    function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    async function refresh() {
      try { set(await csp.capabilities()); } catch {  }
    }

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

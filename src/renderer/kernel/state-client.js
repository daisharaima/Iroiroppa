'use strict';

// The renderer's client for the canonical state model (docs/STATE.md, §12.2/§12.3).
//
// It holds the local mirror of every domain, follows `state:changed`, and hands a
// registered adapter the snapshot for its domain. A window renders from the model
// through an adapter; it never hand-mirrors a channel (invariant §5.2).
//
// `stateMode` (from preload) decides whether this is even live: in `legacy` mode
// the per-domain channels are still the source, and this module only mirrors.
//
// Browser code: reads `window`/`window.csp`, unit-tested with a faked global like
// command-bus.js.

(function () {
  const csp = window.csp;
  const values = {};    // domain -> value
  const revisions = {}; // domain -> rev
  const adapters = new Map(); // domain -> Set<fn>

  /** Apply one domain change and notify its adapters. */
  function apply(domain, value, rev) {
    if (!domain) return;
    // Drop a stale or duplicate revision: a delta that raced ahead of the hydrate
    // snapshot must not be clobbered by it (docs/STATE.md, invariants).
    if (domain in revisions && Number.isFinite(rev) && rev <= revisions[domain]) return;
    values[domain] = value;
    revisions[domain] = Number.isFinite(rev) ? rev : (revisions[domain] || 0) + 1;
    const set = adapters.get(domain);
    if (!set) return;
    for (const fn of [...set]) { try { fn(value, revisions[domain]); } catch { /* keep going */ } }
  }

  /** Apply a full `{ version, domains }` envelope. */
  function applySnapshot(env) {
    if (!env || !env.domains) return;
    for (const [id, entry] of Object.entries(env.domains)) {
      apply(id, entry && entry.value, entry && entry.rev);
    }
  }

  /** Register a pure adapter for a domain. Returns an unsubscribe. */
  function register(domain, fn) {
    if (!adapters.has(domain)) adapters.set(domain, new Set());
    adapters.get(domain).add(fn);
    // A domain already known replays immediately, so ordering never matters.
    if (domain in values) { try { fn(values[domain], revisions[domain]); } catch { /* keep going */ } }
    return () => { const set = adapters.get(domain); if (set) set.delete(fn); };
  }

  const value = (domain) => (domain in values ? values[domain] : null);
  const rev = (domain) => revisions[domain] || 0;

  /** Send an intent to main (the only writer). */
  function intent(name, payload) {
    if (csp && typeof csp.intent === 'function') return csp.intent(name, payload);
    return Promise.resolve({ ok: false, error: 'intent unavailable' });
  }

  /** Pull the whole envelope once (used at boot). */
  async function hydrate() {
    if (!csp || typeof csp.stateSnapshot !== 'function') return null;
    try {
      const env = await csp.stateSnapshot();
      applySnapshot(env);
      return env;
    } catch { return null; }
  }

  const mode = (csp && csp.stateMode) || 'legacy';
  if (mode === 'model' && csp && typeof csp.onStateChanged === 'function') {
    csp.onStateChanged((change) => {
      if (change && change.domain) apply(change.domain, change.value, change.rev);
    });
    hydrate();
  }

  window.Iro = window.Iro || {};
  window.Iro.state = {
    mode,
    register,
    value,
    rev,
    intent,
    hydrate,
    apply,
    applySnapshot,
    domains: () => Object.keys(values),
  };
})();

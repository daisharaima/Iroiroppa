'use strict';

(function () {
  const csp = window.csp;
  const values = {};
  const revisions = {};
  const adapters = new Map();

  /** Apply one domain change and notify its adapters. */
  function apply(domain, value, rev) {
    if (!domain) return;

    if (domain in revisions && Number.isFinite(rev) && rev <= revisions[domain]) return;
    values[domain] = value;
    revisions[domain] = Number.isFinite(rev) ? rev : (revisions[domain] || 0) + 1;
    const set = adapters.get(domain);
    if (!set) return;
    for (const fn of [...set]) { try { fn(value, revisions[domain]); } catch {  } }
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

    if (domain in values) { try { fn(values[domain], revisions[domain]); } catch {  } }
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

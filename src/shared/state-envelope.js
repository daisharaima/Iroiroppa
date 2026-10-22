/*
 * The state envelope (docs/STATE.md, §4.3).
 *
 * One versioned, serialisable snapshot of every domain: `{ version, domains }`,
 * where each domain is `{ rev, value }`. It is the single shape that crosses IPC
 * and, later, a peer port — so any consumer can be validated the same way.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;

  const isObject = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

  function createEnvelope(domains = {}) {
    return { version: VERSION, domains: { ...domains } };
  }

  /** A copy of `env` with one domain replaced by `{ rev, value }`. */
  function withDomain(env, id, rev, value) {
    const domains = { ...(env && env.domains) };
    domains[id] = { rev, value };
    return { version: VERSION, domains };
  }

  function isEnvelope(x) {
    return isObject(x) && x.version === VERSION && isObject(x.domains);
  }

  function normalizeEnvelope(raw) {
    return isEnvelope(raw) ? { version: VERSION, domains: { ...raw.domains } } : null;
  }

  return { VERSION, createEnvelope, withDomain, isEnvelope, normalizeEnvelope };
});

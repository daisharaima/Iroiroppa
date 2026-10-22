/*
 * The state-domain registry (docs/STATE.md, §12.2).
 *
 * Named, versioned buckets of app state. A domain is `kind: 'tokens'` (its value
 * is a DTCG token payload, validated) or `kind: 'opaque'` (arbitrary
 * JSON-serialisable value). Main is the only writer; the registry only says how
 * to normalise and validate a value, so the hub stays small.
 *
 * Colour *editing* is NOT a domain: it stays renderer-side (§2.4). `color` here
 * is the incoming mirror of the Companion service's last colour.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./token-schema'));
  } else {
    root.IroStateDomains = factory(root.IroTokenSchema);
  }
})(typeof self !== 'undefined' ? self : this, function (Schema) {
  'use strict';

  // `owner` names the one writer that may change the domain (docs/STATE.md):
  // `service` (the Companion link), `capabilities`, `layout-service`, or `main`.
  const DOMAINS = {
    capabilities: { version: 1, kind: 'opaque', persisted: false, owner: 'capabilities' },
    connection: { version: 1, kind: 'opaque', persisted: false, owner: 'service' },
    color: { version: 1, kind: 'opaque', persisted: false, owner: 'service' },
    history: { version: 1, kind: 'tokens', persisted: false, owner: 'main' },
    layout: { version: 1, kind: 'opaque', persisted: true, owner: 'layout-service' },
    health: { version: 1, kind: 'opaque', persisted: false, owner: 'main' },
  };

  const ids = () => Object.keys(DOMAINS);
  const get = (id) => DOMAINS[id] || null;
  const kind = (id) => (DOMAINS[id] ? DOMAINS[id].kind : 'opaque');

  /**
   * Normalise a value for a domain. A token domain is validated as a token
   * payload; an opaque domain only has to be JSON-serialisable. Returns
   * `{ ok, value }` or `{ ok:false, error }`.
   */
  function normalize(id, value) {
    const def = DOMAINS[id];
    if (!def) return { ok: false, error: `unknown domain "${id}"` };
    if (def.kind === 'tokens') return Schema.validateTokenPayload(value);
    try { JSON.stringify(value); } catch { return { ok: false, error: `${id}: value is not serialisable` }; }
    return { ok: true, value };
  }

  return { DOMAINS, ids, get, kind, normalize };
});

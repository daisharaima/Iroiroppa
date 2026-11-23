
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./token-schema'));
  } else {
    root.IroStateDomains = factory(root.IroTokenSchema);
  }
})(typeof self !== 'undefined' ? self : this, function (Schema) {
  'use strict';

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

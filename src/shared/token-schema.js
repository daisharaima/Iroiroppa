/*
 * Token validation and consumer helpers (docs/STATE.md, §12.2).
 *
 * Clean-room reimplementation of token-beam's zod schema and consumer helpers,
 * with **no dependency**. Every validator returns `{ ok, value }` or
 * `{ ok:false, error }` and never throws, so a malformed message from any window
 * (or, later, an external tool) is rejected at the boundary instead of crashing.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./token-model'));
  } else {
    root.IroTokenSchema = factory(root.IroTokenModel);
  }
})(typeof self !== 'undefined' ? self : this, function (Model) {
  'use strict';

  // The same caps token-beam enforces, so we accept exactly what it accepts.
  const LIMITS = {
    name: 256, string: 10000, tokens: 10000, modes: 100, collections: 500,
  };

  const SYNC_MESSAGE_TYPES = ['pair', 'sync', 'ping', 'pong', 'error', 'warning', 'peer-disconnected'];
  const SESSION_TOKEN_RE = /^(?:beam:\/\/)?([0-9a-f]+)$/i;

  const isObject = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
  const isScalar = (x) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean';

  function bad(error) { return { ok: false, error }; }
  function good(value) { return { ok: true, value }; }

  function validateTokenName(name, what) {
    if (typeof name !== 'string' || !name.length) return `${what}.name required`;
    if (name.length > LIMITS.name) return `${what}.name too long`;
    return null;
  }

  function validateToken(t) {
    if (!isObject(t)) return 'token must be an object';
    const nameErr = validateTokenName(t.name, 'token');
    if (nameErr) return nameErr;
    if (!Model.TOKEN_TYPES.includes(t.type)) return `unknown token type "${t.type}"`;
    if (!isScalar(t.value)) return 'token.value must be a string, number or boolean';
    if (typeof t.value === 'string' && t.value.length > LIMITS.string) return 'token.value too long';
    return null;
  }

  function validateMode(m) {
    if (!isObject(m)) return 'mode must be an object';
    const nameErr = validateTokenName(m.name, 'mode');
    if (nameErr) return nameErr;
    if (!Array.isArray(m.tokens)) return 'mode.tokens must be an array';
    if (m.tokens.length > LIMITS.tokens) return 'too many tokens in a mode';
    for (const t of m.tokens) { const e = validateToken(t); if (e) return e; }
    return null;
  }

  function validateCollection(c) {
    if (!isObject(c)) return 'collection must be an object';
    const nameErr = validateTokenName(c.name, 'collection');
    if (nameErr) return nameErr;
    if (!Array.isArray(c.modes)) return 'collection.modes must be an array';
    if (c.modes.length > LIMITS.modes) return 'too many modes in a collection';
    for (const m of c.modes) { const e = validateMode(m); if (e) return e; }
    return null;
  }

  /** Validate a `TokenSyncPayload` (`{ collections: [...] }`). */
  function validateTokenPayload(payload) {
    if (!isObject(payload)) return bad('payload must be an object');
    if (!Array.isArray(payload.collections)) return bad('collections must be an array');
    if (payload.collections.length > LIMITS.collections) return bad('too many collections');
    for (const c of payload.collections) { const e = validateCollection(c); if (e) return bad(e); }
    return good(payload);
  }

  /** Validate a `state:snapshot` envelope (`{ version, domains }`). */
  function validateStateEnvelope(env) {
    if (!isObject(env)) return bad('envelope must be an object');
    if (!isObject(env.domains)) return bad('domains must be an object');
    return good(env);
  }

  /** Every token, flattened, tagged with its collection and mode. */
  function flattenPayload(payload) {
    const parsed = validateTokenPayload(payload);
    if (!parsed.ok) return [];
    const out = [];
    for (const collection of parsed.value.collections) {
      for (const mode of collection.modes) {
        for (const token of mode.tokens) out.push({ collectionName: collection.name, modeName: mode.name, token });
      }
    }
    return out;
  }

  /** Keep only tokens whose type is in `types`; drops now-empty modes/collections. */
  function filterPayloadByType(payload, types = Model.TOKEN_TYPES) {
    const parsed = validateTokenPayload(payload);
    if (!parsed.ok) return null;
    const wanted = new Set(types);
    const collections = parsed.value.collections
      .map((c) => ({
        name: c.name,
        modes: c.modes
          .map((m) => ({ name: m.name, tokens: m.tokens.filter((t) => wanted.has(t.type)) }))
          .filter((m) => m.tokens.length > 0),
      }))
      .filter((c) => c.modes.length > 0);
    return { collections };
  }

  /** Colour tokens only, each with its hex string. */
  function extractColorTokens(payload) {
    return flattenPayload(payload)
      .filter((e) => e.token.type === 'color')
      .filter((e) => Model.isHexColor(e.token.value))
      .map((e) => ({ ...e, hex: e.token.value }));
  }

  function isSyncMessage(value) {
    return isObject(value) && typeof value.type === 'string' && SYNC_MESSAGE_TYPES.includes(value.type);
  }

  function parseSyncMessage(raw) {
    try { const m = JSON.parse(raw); return isSyncMessage(m) ? m : null; } catch { return null; }
  }

  /** `abc123` / `beam://abc123` → `beam://ABC123`, or null when invalid. */
  function normalizeSessionToken(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = SESSION_TOKEN_RE.exec(trimmed);
    return match ? `beam://${match[1].toUpperCase()}` : null;
  }

  /** A `[warn]…` message is non-fatal; anything else is a fatal error. */
  function isWarningError(error) {
    return typeof error === 'string' && error.startsWith('[warn]');
  }

  return {
    LIMITS, SYNC_MESSAGE_TYPES,
    validateTokenPayload, validateStateEnvelope, validateToken, validateMode, validateCollection,
    flattenPayload, filterPayloadByType, extractColorTokens,
    isSyncMessage, parseSyncMessage, normalizeSessionToken, isWarningError,
  };
});

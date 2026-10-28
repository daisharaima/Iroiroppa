/*
 * The token model (docs/STATE.md, §12.2).
 *
 * The DTCG-style shape Iroiroppa shares with other tools: a payload is a list of
 * collections, each a list of modes, each a list of named typed tokens. This is
 * the *interop* shape — the live colour stays OKLab in the renderer and a token
 * carries hex only at the export edge (§12.5).
 *
 * Clean-room reimplementation of the token layer types/format (see the
 * licence boundary in docs/STATE.md). Loads as CommonJS in Node and as the global
 * `IroTokenModel` in the renderer, like capabilities.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroTokenModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TOKEN_TYPES = ['color', 'number', 'string', 'boolean'];

  const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

  function isHexColor(value) {
    return typeof value === 'string' && HEX_RE.test(value.trim());
  }

  /** Infer a token type from its value (the token layer's `resolveToken`). */
  function inferType(value) {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (isHexColor(value)) return 'color';
    return 'string';
  }

  /** A single token; an explicit known type wins over inference. */
  function resolveToken(name, value, type) {
    return { name: String(name), type: TOKEN_TYPES.includes(type) ? type : inferType(value), value };
  }

  /** `{ name: value }` / `[[name, value, type?]]` / `[token]` → a token list. */
  function toTokenList(tokens) {
    if (Array.isArray(tokens)) {
      return tokens.map((t) => (Array.isArray(t)
        ? resolveToken(t[0], t[1], t[2])
        : resolveToken(t.name, t.value, t.type)));
    }
    return Object.entries(tokens || {}).map(([name, value]) => resolveToken(name, value));
  }

  /** One token list → a one-mode collection (default mode `Value`). */
  function createCollection(name, tokens = {}, { mode = 'Value' } = {}) {
    return { name: String(name), modes: [{ name: mode, tokens: toTokenList(tokens) }] };
  }

  /** `{ modeName: { tokenName: value } }` → a collection with one mode per key. */
  function createMultiModeCollection(name, modes = {}) {
    return {
      name: String(name),
      modes: Object.entries(modes).map(([modeName, tokens]) => ({
        name: String(modeName),
        tokens: toTokenList(tokens),
      })),
    };
  }

  /** A payload shell from one or more collections. */
  function createPayload(...collections) {
    return { collections: collections.filter(Boolean) };
  }

  /** Tokens of the given types, flattened across collections and modes. */
  function tokensByType(payload, types = TOKEN_TYPES) {
    const wanted = new Set(types);
    const out = [];
    for (const c of (payload && payload.collections) || []) {
      for (const m of c.modes || []) {
        for (const t of m.tokens || []) {
          if (wanted.has(t.type)) out.push({ collection: c.name, mode: m.name, token: t });
        }
      }
    }
    return out;
  }

  return {
    TOKEN_TYPES, isHexColor, inferType, resolveToken,
    createCollection, createMultiModeCollection, createPayload, tokensByType,
  };
});

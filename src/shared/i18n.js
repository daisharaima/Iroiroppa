/*
 * Tiny i18n core. No dependency: a flat message
 * catalog, `{var}` interpolation, and locale resolution against what is actually
 * shipped. Locales live as UMD modules in `src/shared/locales/<code>.js`, so the
 * renderer can load one with a `<script>` tag (it has no build step) and main can
 * `require` the same file.
 *
 * Loads as CommonJS in Node and as a global `IroI18n` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroI18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Replace `{name}` markers; an unknown marker is left as-is. */
  function format(template, vars) {
    if (!vars) return String(template);
    return String(template).replace(/\{(\w+)\}/g, (m, key) => (
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m
    ));
  }

  /**
   * Pick the best shipped locale for a preference list (`['fr-CA','fr']`).
   * Tries an exact match, then the base language, then the fallback.
   */
  function resolve(preferred, available, fallback = 'en') {
    const list = Array.isArray(preferred) ? preferred : [preferred];
    const have = (available || []).map((c) => String(c).toLowerCase());
    for (const raw of list) {
      const want = String(raw || '').replace(/_/g, '-').toLowerCase();
      if (!want) continue;
      if (have.includes(want)) return want;
      const base = want.split('-')[0];
      if (have.includes(base)) return base;
    }
    return have.includes(fallback) ? fallback : (have[0] || fallback);
  }

  /**
   * @param {object} opts
   * @param {object} opts.messages `{ key: 'text with {vars}' }`
   * @param {string} [opts.fallback]
   */
  function createI18n({ messages = {}, fallback = 'en' } = {}) {
    /** Translate a key; a missing key falls back to the key itself. */
    function t(key, vars) {
      const value = messages[key];
      return value == null ? format(key, vars) : format(value, vars);
    }
    return { t, messages, fallback };
  }

  return { createI18n, resolve, format };
});

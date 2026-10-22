'use strict';

// Main-process i18n. The catalogs are the same UMD
// modules the renderer loads, so one file serves both; main layers the chosen
// locale over English and re-reads it when the language setting changes.

const path = require('node:path');

const LOCALE_DIR = path.join(__dirname, '..', 'shared', 'locales');
// A language code, never a path: `loadLocale` feeds `require()` below, so a value
// like `../../user-modules/x/module` must not reach it (docs/STATE.md, IPC sender).
const LOCALE_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
const cache = new Map();

/** Load one locale catalog, or null when it is not shipped. */
function loadLocale(code) {
  const key = String(code || '').replace(/_/g, '-').toLowerCase();
  if (!key || !LOCALE_CODE.test(key)) return null;
  if (cache.has(key)) return cache.get(key);
  let messages = null;
  try {
    // eslint-disable-next-line global-require
    messages = require(path.join(LOCALE_DIR, `${key}.js`)) || null;
  } catch {
    messages = null;
  }
  cache.set(key, messages);
  return messages;
}

function format(template, vars) {
  if (!vars) return String(template);
  return String(template).replace(/\{(\w+)\}/g, (m, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m
  ));
}

/**
 * @param {object} opts
 * @param {string} [opts.language] the stored language ('' follows the system)
 * @param {string} [opts.systemLocale] e.g. `app.getLocale()`
 */
function createMainI18n({ language = '', systemLocale = 'en' } = {}) {
  const base = loadLocale('en') || {};
  let messages = base;

  /** Switch language: exact code, then base language; English is the base. */
  function use(code) {
    const raw = String(code || systemLocale || 'en');
    const overlay = raw.toLowerCase().startsWith('en')
      ? null
      : (loadLocale(raw) || loadLocale(raw.split('-')[0]));
    messages = overlay ? { ...base, ...overlay } : base;
  }

  /** Translate a key; a missing key falls back to the key itself. */
  function t(key, vars) {
    const value = messages[key];
    return value == null ? format(key, vars) : format(value, vars);
  }

  use(language);
  return { use, t };
}

module.exports = { createMainI18n, loadLocale };

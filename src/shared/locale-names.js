/*
 * Endonyms for the language picker: every language is written in its own
 * language, as Photoshop does. Codes match src/shared/locales/<code>.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroLocaleNames = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const NAMES = {
    en: 'English',
    fr: 'Français',
    de: 'Deutsch',
    ja: '日本語',
    es: 'Español',
    it: 'Italiano',
    'pt-br': 'Português (Brasil)',
    nl: 'Nederlands',
    sv: 'Svenska',
    da: 'Dansk',
    nb: 'Norsk bokmål',
    fi: 'Suomi',
    pl: 'Polski',
    cs: 'Čeština',
    hu: 'Magyar',
    ro: 'Română',
    ru: 'Русский',
    uk: 'Українська',
    tr: 'Türkçe',
    ar: 'العربية',
    he: 'עברית',
    th: 'ไทย',
    vi: 'Tiếng Việt',
    id: 'Bahasa Indonesia',
    'zh-cn': '简体中文',
    'zh-tw': '繁體中文',
    ko: '한국어',
  };
  const RTL = new Set(['ar', 'he']);
  function nameOf(code) { return NAMES[String(code || '').toLowerCase()] || String(code || ''); }
  function isRtl(code) { return RTL.has(String(code || '').toLowerCase()); }
  return { NAMES, nameOf, isRtl };
});

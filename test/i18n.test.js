'use strict';

// The i18n core: interpolation, locale resolution and
// catalog lookup, plus the shipped locales' completeness.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createI18n, resolve, format } = require('../src/shared/i18n');

const LOCALE_DIR = path.join(__dirname, '..', 'src', 'shared', 'locales');
const localeFiles = () => fs.readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.js')).sort();
const loadLocale = (file) => require(path.join(LOCALE_DIR, file));

test('format replaces named markers and leaves unknowns', () => {
  assert.equal(format('Hello {name}', { name: 'Ada' }), 'Hello Ada');
  assert.equal(format('{a} + {b}', { a: 1, b: 2 }), '1 + 2');
  assert.equal(format('Hi {who}', {}), 'Hi {who}');
  assert.equal(format('plain'), 'plain');
});

test('resolve matches exact, base language, then fallback', () => {
  const avail = ['en', 'fr', 'ja', 'zh-tw'];
  assert.equal(resolve(['fr-CA', 'fr'], avail), 'fr');
  assert.equal(resolve('ja-JP', avail), 'ja');
  assert.equal(resolve('de-DE', avail), 'en', 'falls back to English');
  assert.equal(resolve('zh-TW', avail), 'zh-tw', 'exact region match wins');
  assert.equal(resolve([], avail), 'en');
});

test('createI18n translates and falls back to the key', () => {
  const i18n = createI18n({ messages: { greeting: 'Hi {name}' } });
  assert.equal(i18n.t('greeting', { name: 'Bo' }), 'Hi Bo');
  assert.equal(i18n.t('missing.key'), 'missing.key');
});

test('every shipped locale is a subset of English, and English is complete', () => {
  const locales = localeFiles();
  assert.ok(locales.includes('en.js'), 'the English catalog is the source');
  const en = loadLocale('en.js');
  const enKeys = Object.keys(en).sort();
  assert.ok(enKeys.length > 0, 'the English catalog is empty');
  for (const file of locales) {
    const messages = loadLocale(file);
    // A locale may omit a key (it then falls back to English); it must not carry a
    // key English does not, which would be a stale leftover.
    const stale = Object.keys(messages).filter((k) => !(k in en));
    assert.deepEqual(stale, [], `${file} has keys English does not`);
  }
});

test('the English catalog covers every data-i18n key and every Iro.t() key', () => {
  const en = loadLocale('en.js');
  const renderer = path.join(__dirname, '..', 'src', 'renderer');
  const attr = /data-i18n(?:-title|-aria-label|-placeholder|-lead)?="([^"]+)"/g;
  const call = /(?:window\.Iro\.t|ctx\.t)\('([^']+)'\)/g;
  const missing = new Set();
  const dirs = [
    renderer,
    path.join(renderer, 'selector_module'),
    path.join(renderer, 'kernel'),
    path.join(renderer, '..', 'main'),
  ];
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html') || f.endsWith('.js'))) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const re of [attr, call]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          if (!(m[1] in en)) missing.add(`${m[1]} (${file})`);
        }
      }
    }
  }
  assert.deepEqual([...missing].sort(), [], 'missing English keys');
});

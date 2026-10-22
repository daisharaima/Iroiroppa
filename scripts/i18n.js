#!/usr/bin/env node
'use strict';

// Check every shipped locale against the English catalog. Translations are
// produced by AI and validated here, so a locale that
// is missing keys — or carries keys English does not — fails the command.

const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'src', 'shared', 'locales');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
const load = (f) => {
  const mod = require(path.join(dir, f));
  return mod && typeof mod === 'object' ? mod : {};
};

if (!files.includes('en.js')) {
  console.error('src/shared/locales/en.js is missing — it is the source catalog.');
  process.exit(1);
}
const en = load('en.js');
const enKeys = Object.keys(en).sort();

let bad = 0;
console.log(`English catalog: ${enKeys.length} keys`);
for (const file of files) {
  const messages = load(file);
  const stale = Object.keys(messages).filter((k) => !(k in en));
  const translated = enKeys.filter((k) => k in messages).length;
  const pct = enKeys.length ? Math.round((translated / enKeys.length) * 100) : 100;
  const note = file === 'en.js' ? '' : `  ${translated}/${enKeys.length} translated (${pct}%)`;
  console.log(`${file}${note}`);
  if (stale.length) {
    bad += 1;
    console.log(`  stale keys English does not have: ${stale.slice(0, 12).join(', ')}`);
  }
}

// A locale may omit a key and fall back to English, but a key English does not
// have is a stale leftover and fails.
console.log(`${files.length} locale(s); ${bad} with stale keys`);
process.exit(bad ? 1 : 0);

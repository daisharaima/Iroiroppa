'use strict';

// The spelling guard for the user-facing surfaces: American "color"/"license" in
// the English catalog, README, Settings markup and the user guide. Internal docs
// and code comments keep the maintainer's British spelling and are not scanned.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const BRITISH = /\b(colour|colours|coloured|colouring|licence)\b/i;

test('the English catalog values are American', () => {
  const messages = require('../src/shared/locales/en.js');
  for (const [key, value] of Object.entries(messages)) {
    assert.doesNotMatch(String(value), BRITISH, `${key}: ${value}`);
  }
});

test('README and Settings markup are American', () => {
  for (const rel of ['README.md', 'src/renderer/settings.html']) {
    // Attributes carry i18n keys and element ids, which are internal names and may
    // keep the British spelling; only the visible text is part of the rule.
    const text = read(rel).replace(/\s(?:data-i18n[\w-]*|id|class|for)="[^"]*"/g, '');
    assert.doesNotMatch(text, BRITISH, `${rel} still has a British spelling`);
  }
});

test('the user guide is American and has no old page names', () => {
  const dir = path.join(ROOT, 'wiki');
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  for (const page of pages) {
    assert.doesNotMatch(read(`wiki/${page}`), BRITISH, `wiki/${page} still has a British spelling`);
    assert.doesNotMatch(read(`wiki/${page}`), /Colour-(pickers|profiles-and-gamut|info-panels|)/, `wiki/${page} links an old page`);
  }
  for (const old of ['Colour-pickers.md', 'Colour-profiles-and-gamut.md', 'Colour-info-panels.md', 'Pick-a-colour.md']) {
    assert.ok(!fs.existsSync(path.join(dir, old)), `${old} still exists`);
  }
});

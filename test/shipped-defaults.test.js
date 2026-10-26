'use strict';

// Ship-time guards for the two defaults that must not be personal: the CSP
// folder starts on Auto (Documents\CELSYS at runtime) and the guide starts on
// OKLab; no developer path belongs in source or the screenshot fixture.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('shipped defaults keep CSP data on Auto', () => {
  const main = read('src/main/main.js');
  assert.match(main, /cspDataDir:\s*''/);
});

test('source and screenshot fixture carry no personal data path', () => {
  for (const rel of ['scripts/screenshot.js', 'src/main/main.js', 'src/main/csp-shortcuts.js']) {
    const text = read(rel);
    assert.doesNotMatch(text, /mydata/i, `${rel} mentions a personal data folder`);
    assert.doesNotMatch(text, /[A-Za-z]:\\Users\\/i, `${rel} contains an absolute user path`);
  }
});

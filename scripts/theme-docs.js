#!/usr/bin/env node
'use strict';

// Regenerate the token table in docs/THEMES.md from the manifest, so the doc can
// never drift from src/shared/theme-tokens.js. Run via `npm run theme:docs`; the
// test fails if the file is out of date.

const fs = require('node:fs');
const path = require('node:path');
const T = require('../src/shared/theme-tokens');

const DOC = path.join(__dirname, '..', 'docs', 'THEMES.md');
const text = fs.readFileSync(DOC, 'utf8');
const start = text.indexOf(T.TOKEN_MARK_START);
const end = text.indexOf(T.TOKEN_MARK_END);
if (start < 0 || end < 0 || end < start) {
  console.error('docs/THEMES.md is missing its tokens markers');
  process.exit(1);
}
const next = text.slice(0, start + T.TOKEN_MARK_START.length)
  + '\n' + T.renderTokenSection() + '\n'
  + text.slice(end);
fs.writeFileSync(DOC, next);
console.log('updated docs/THEMES.md (' + T.TOKENS.length + ' tokens)');
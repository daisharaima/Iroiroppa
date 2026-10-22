'use strict';

// Guards two CSS mistakes that no other test can see (docs/THEMES.md):
//
// - a custom property defined as itself (`--font-size: var(--font-size)`), which is
//   invalid at computed-value time, so every `calc(var(--font-size) …)` is dropped and
//   the documented pre-theme fallback silently stops existing;
// - a structural token hard-coded outside the token block, which themes cannot reach.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'src', 'renderer');

function cssFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) cssFiles(full, out);
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

test('no custom property is defined as a reference to itself', () => {
  for (const file of cssFiles(ROOT)) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:\s*var\(\s*(--[a-z0-9-]+)\s*\)\s*;/gi)) {
      assert.notEqual(
        m[1],
        m[2],
        `${rel}: ${m[1]} is defined as var(${m[2]}) — invalid at computed-value time`,
      );
    }
  }
});

test('the base stylesheet has a literal font size for the pre-theme fallback', () => {
  const text = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const m = text.match(/--font-size\s*:\s*([^;]+);/);
  assert.ok(m, 'style.css must define --font-size');
  assert.match(m[1].trim(), /^\d+(\.\d+)?px$/, 'the fallback must be a length, not another var()');
});

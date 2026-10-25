'use strict';

// Regenerates the vendored Helmlab bundle (docs/COLOR.md, THIRD_PARTY.md).
//
// helmlab is MIT. The npm package is a devDependency — only the browser bundle
// this writes is shipped, wrapped so the same file loads as `window.helmlab` in
// the renderer and as a CommonJS module in Node (the tests and the models both
// need it there).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'node_modules', 'helmlab', 'package.json');
const SRC = path.join(ROOT, 'node_modules', 'helmlab', 'dist', 'index.global.js');
const OUT_DIR = path.join(ROOT, 'src', 'renderer', 'vendor', 'helmlab');
const OUT = path.join(OUT_DIR, 'helmlab.umd.js');

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('helmlab is not installed — run `npm install` first.');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const body = fs.readFileSync(SRC, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/^"use strict";\s*/, '')
    .replace(/\/\/# sourceMappingURL=.*$/m, '')
    .trimEnd();

  const out = [
    `/*! Helmlab ${pkg.version} — MIT, https://github.com/Grkmyldz148/helmlab`,
    ' *  Vendored by scripts/vendor-helmlab.js; do not edit by hand.',
    ' *  Loads as `window.helmlab` in the renderer and as a CommonJS module in Node. */',
    '(function (root, factory) {',
    "  if (typeof module === 'object' && module.exports) module.exports = factory();",
    '  else root.helmlab = factory();',
    "})(typeof self !== 'undefined' ? self : this, function () {",
    body,
    'return helmlab;',
    '});',
    '',
  ].join('\n');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, out);
  fs.copyFileSync(
    path.join(ROOT, 'node_modules', 'helmlab', 'LICENSE'),
    path.join(OUT_DIR, 'LICENSE'),
  );
  console.log(`wrote ${path.relative(ROOT, OUT)} from helmlab ${pkg.version} (${(out.length / 1024).toFixed(0)} KB)`);
}

main();

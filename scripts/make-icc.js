'use strict';

// Regenerates src/assets/synthetic.icc — the tiny synthetic profile the app
// ships so a fresh install has something to prove against, and the tests have a
// machine-independent fixture. Run with `npm run icc`. The bytes are rebuilt
// deterministically, so re-running on an unchanged builder is a no-op.

const fs = require('node:fs');
const path = require('node:path');

const { buildSyntheticIcc } = require('../src/shared/synthetic-icc');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'assets', 'synthetic.icc');

const buf = buildSyntheticIcc();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);
console.log(`wrote ${path.relative(ROOT, OUT)} (${buf.length} bytes)`);

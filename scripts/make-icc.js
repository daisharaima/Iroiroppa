'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { buildSyntheticIcc } = require('../src/shared/synthetic-icc');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'assets', 'synthetic.icc');

const buf = buildSyntheticIcc();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);
console.log(`wrote ${path.relative(ROOT, OUT)} (${buf.length} bytes)`);

#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateTheme, validateThemeCss } = require('../src/shared/theme-validate');

const args = process.argv.slice(2);
const json = args.includes('--json');
const partial = args.includes('--partial');
const named = args.filter((a) => !a.startsWith('--'));
const THEME_DIR = path.join(__dirname, '..', 'src', 'renderer', 'themes');
const targets = named.length
  ? named
  : fs.readdirSync(THEME_DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(THEME_DIR, f));

let failed = false;
const report = [];
for (const file of targets) {
  let theme;
  try {
    theme = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    report.push({ file, errors: ['cannot read: ' + err.message], warnings: [] });
    failed = true;
    continue;
  }
  const { errors, warnings } = validateTheme(theme, { partial });

  let css = '';
  try { css = fs.readFileSync(file.replace(/\.json$/i, '.css'), 'utf8'); } catch {  }
  if (css) {
    const lint = validateThemeCss(css, { strict: !partial });
    errors.push(...lint.errors);
    warnings.push(...lint.warnings);
  }
  if (errors.length) failed = true;
  report.push({ file: path.relative(process.cwd(), file).replace(/\\/g, '/'), errors, warnings });
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const r of report) {
    const status = r.errors.length ? 'FAIL' : r.warnings.length ? 'warn' : 'ok';
    console.log(status.padEnd(4) + ' ' + r.file);
    for (const e of r.errors) console.log('  error: ' + e);
    for (const w of r.warnings) console.log('  warn:  ' + w);
  }
}
process.exit(failed ? 1 : 0);
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const FLAGS = new Set(ARGS.filter((a) => a.startsWith('-')));
const FILTER = ARGS.filter((a) => !a.startsWith('-')).join(' ');
const DIRS = ['src', 'scripts'];

const PATTERNS = [
  /^\s*(?:module\.exports\s*=\s*)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^\s*class\s+([A-Za-z_$][\w$]*)/,
  /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function)/,
  /^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/,
  /^\s*([a-z][\w$]*)\s*:\s*(?:async\s*)?(?:function|\()/,
  /^\s*\/\/\s*---\s*(.+?)\s*-{2,}/,
  /^\s*(?:module\.exports\.[\w$]+)\('([^']+)'/,
];

const IPC = /ipcMain\.(?:handle|on)\('([^']+)'/;

const NOISE = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'do', 'try', 'case', 'typeof']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function declarations(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (line.length > 200) return;
    const ipc = IPC.exec(line);
    if (ipc) {
      hits.push(`${String(i + 1).padStart(5)}  ${ipc[1]}`);
      return;
    }
    for (const re of PATTERNS) {
      const m = re.exec(line);
      if (m && m[1] && !NOISE.has(m[1].trim())) {
        hits.push(`${String(i + 1).padStart(5)}  ${m[1].trim().slice(0, 60)}`);
        return;
      }
    }
  });
  return { lines: lines.length, hits };
}

function main() {
  const files = DIRS.flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? walk(path.join(ROOT, d)) : []))
    .filter((f) => !FILTER || f.toLowerCase().includes(FILTER.toLowerCase()))
    .sort();

  const entries = files.map((file) => {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    return { rel, ...declarations(file) };
  });

  const indexed = entries.filter((e) => e.hits.length).length;
  console.log(`# ${entries.length} files, ${indexed} indexed${FILTER ? ` (filter "${FILTER}")` : ''}`);

  if (FLAGS.has('--files')) {
    for (const e of entries) {
      console.log(`${String(e.hits.length).padStart(4)} hits  ${String(e.lines).padStart(5)} lines  ${e.rel}`);
    }
    return;
  }

  for (const e of entries) {
    if (!e.hits.length) continue;
    console.log(`\n${e.rel}  (${e.lines} lines)`);
    console.log(e.hits.join('\n'));
  }
}

main();

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'src', 'main');
const ALLOWED = new Set(['src/main/broadcast.js']);
const SHAPE = /\.webContents\.send\(/;

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function offendersIn(files) {
  const out = [];
  for (const file of files) {
    file.text.split('\n').forEach((line, index) => {
      if (SHAPE.test(line) && !ALLOWED.has(file.path)) out.push(`${file.path}:${index + 1}: ${line.trim()}`);
    });
  }
  return out;
}

test('the shape is recognised, so an empty scan cannot pass by accident', () => {
  const found = offendersIn([{ path: 'src/main/example.js', text: "  win.webContents.send('x', 1);\n" }]);
  assert.deepEqual(found, ["src/main/example.js:1: win.webContents.send('x', 1);"]);
});

test('the allowlist names the guard and the guard still sends', () => {
  const guard = fs.readFileSync(path.join(ROOT, 'src', 'main', 'broadcast.js'), 'utf8');
  assert.match(guard, SHAPE);
});

test('no window send in src/main bypasses broadcast.js', () => {
  const files = jsFiles(MAIN).map((file) => ({
    path: path.relative(ROOT, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8'),
  }));
  assert.deepEqual(offendersIn(files), []);
});
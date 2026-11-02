#!/usr/bin/env node
// Build the native helper with the C# compiler that ships with Windows.
//
//   node scripts/build-host.js [--check]
//
// No SDK, no NuGet, no extra runtime: the .NET Framework 4 compiler is present on
// every Windows 10/11 machine. `--check` reports whether the output is current
// without writing anything (the tests and `pack` use it).

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'src', 'main', 'native', 'irohost.cs');
const outDir = path.join(root, 'src', 'main', 'native', 'bin');
const outFile = path.join(outDir, 'irohost.exe');

/** The in-box compiler: prefer the 64-bit framework, fall back to the 32-bit one. */
function findCompiler() {
  const win = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return null;
}

/** True when the built exe is newer than its source. */
function isCurrent() {
  try {
    return fs.statSync(outFile).mtimeMs >= fs.statSync(source).mtimeMs;
  } catch {
    return false;
  }
}

function build() {
  const csc = findCompiler();
  if (!csc) {
    throw new Error('the in-box C# compiler (csc.exe) was not found under %WINDIR%\\Microsoft.NET');
  }

  fs.mkdirSync(outDir, { recursive: true });

  // /target:winexe: no console window may ever flash — the process talks over
  // redirected pipes only. /platform:anycpu keeps it architecture-neutral.
  execFileSync(csc, [
    '/nologo',
    '/target:winexe',
    '/platform:anycpu',
    '/optimize+',
    '/warn:4',
    `/out:${outFile}`,
    source,
  ], { stdio: 'inherit', windowsHide: true });

  const size = fs.statSync(outFile).size;
  process.stdout.write(`irohost.exe ${size} bytes -> ${path.relative(root, outFile)}\n`);
}

if (require.main === module) {
  const checkOnly = process.argv.includes('--check');
  if (checkOnly) {
    process.stdout.write(isCurrent() ? 'irohost.exe is current\n' : 'irohost.exe is missing or stale\n');
    process.exit(isCurrent() ? 0 : 1);
  }
  build();
}

module.exports = { build, findCompiler, isCurrent, outFile, source };

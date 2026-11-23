#!/usr/bin/env node

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

  const pkg = require(path.join(root, 'package.json'));
  const version = String(pkg.version || '0.0.0');
  const parts = version.split('.').map((n) => parseInt(n, 10) || 0);
  const versionResource = path.join(outDir, 'irohost-version.cs');
  fs.writeFileSync(versionResource, [
    'using System.Reflection;',
    `[assembly: AssemblyVersion("${parts[0]}.${parts[1]}.${parts[2]}.0")]`,
    `[assembly: AssemblyFileVersion("${parts[0]}.${parts[1]}.${parts[2]}.0")]`,
    '[assembly: AssemblyProduct("Iroiroppa")]',
    '[assembly: AssemblyCompany("Iroiroppa")]',
    `[assembly: AssemblyTitle("Iroiroppa native helper ${version}")]`,
    '[assembly: AssemblyDescription("Always-on-top band repair, foreground watch, mouse and keyboard hooks")]',
    '[assembly: AssemblyCopyright("GPL-3.0")]',
  ].join('\n'), 'utf8');

  execFileSync(csc, [
    '/nologo',
    '/target:winexe',
    '/platform:anycpu',
    '/optimize+',
    '/warn:4',
    `/out:${outFile}`,
    source,
    versionResource,
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

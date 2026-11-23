'use strict';

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const exe = path.join(root, 'dist', 'win-unpacked', 'Iroiroppa.exe');

if (!fs.existsSync(exe)) {
  console.error(`No packaged build at ${exe} — run \`npm run pack\` first.`);
  process.exit(1);
}

if (process.platform === 'win32') {
  const ps = [
    'Get-CimInstance Win32_Process',
    "| Where-Object { ($_.Name -eq 'Iroiroppa.exe') -or ($_.Name -eq 'electron.exe' -and $_.CommandLine -like '*Iroiroppa*') }",
    '| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join(' ');
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
  } catch {  }
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(exe, [], { detached: true, stdio: 'ignore', env });
child.unref();
console.log(`Launched ${exe}`);

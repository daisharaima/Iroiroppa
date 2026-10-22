'use strict';

// Launch the packaged build (docs/DEV.md, "Build and run"). It kills any running
// Iroiroppa first — a second instance silently defers to the single-instance lock
// and looks like "nothing happened" — then starts dist/win-unpacked/Iroiroppa.exe.
// Kill by command line, never by process name alone: other Electron apps run here.

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
  } catch { /* nothing running */ }
}

// A parent shell that exports ELECTRON_RUN_AS_NODE (an agent harness or an IDE does)
// makes the packaged exe run as plain Node: it starts, does nothing and exits 0, so
// `pack:run` reports success while no app is running. Strip it for the child.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(exe, [], { detached: true, stdio: 'ignore', env });
child.unref();
console.log(`Launched ${exe}`);

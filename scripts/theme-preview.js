#!/usr/bin/env node
'use strict';

// Preview a theme without touching real settings and without CSP.
//
//   npm run theme:preview -- blender-dark [out.png]
//
// It runs a throwaway profile (own user-data dir), renders the standard layout at
// 300x900 and prints where the PNG landed (temp by default). Proofing is off, so
// no ICC profile appears.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const id = process.argv[2];
if (!id || id.startsWith('--')) {
  console.error('usage: node scripts/theme-preview.js <themeId> [out.png]');
  process.exit(1);
}
const out = process.argv[3] && !process.argv[3].startsWith('--')
  ? process.argv[3]
  : path.join(os.tmpdir(), 'iroiroppa-theme-' + id + '.png');
const extra = process.argv[3] && !process.argv[3].startsWith('--')
  ? process.argv.slice(4)
  : process.argv.slice(3);

function write(dir, name, value) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iroiroppa-theme-'));
const userData = path.join(tmp, 'user-data');
fs.mkdirSync(path.join(userData, 'modules'), { recursive: true });
write(userData, 'settings.json', {
  liveSync: true, autoHide: true, autoConnect: false, proofMode: 'off', proofProfile: '',
  theme: id, accents: {}, uiScale: 1, hideModuleNames: false, windowSize: { width: 300, height: 900 },
});
write(userData, 'layout.json', {
  version: 1,
  columns: [{
    id: 'c1', width: null,
    modules: [
      { instanceId: 'i1', moduleId: 'csp-color', weight: 24 },
      { instanceId: 'i2', moduleId: 'color-slices', weight: 520 },
    { instanceId: 'i3', moduleId: 'color-slider', weight: 76 },
      { instanceId: 'i4', moduleId: 'color-history', weight: 92 },
    ],
  }],
  floats: [],
});
  write(userData, 'modules/color-slider.json', { version: 3, settings: { showL: true, showC: true, showH: true, thickness: 50 } });
write(userData, 'modules/color-history.json', { version: 2, settings: { tile: 24 } });

const electron = process.platform === 'win32'
  ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');
const shot = path.join(tmp, 'shot.png');
// Strip ELECTRON_RUN_AS_NODE (an agent harness or IDE may export it), which would
// make electron.exe run as plain Node — no window, no capture — and put the app
// path before --user-data-dir, which Electron's own CLI accepts.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const res = spawnSync(electron, [
    '.', '--user-data-dir=' + userData, '--shot', shot, '--size', '300x900',
    '--theme', id, '--shot-wait', '3500', ...extra,
  ], { cwd: ROOT, stdio: 'inherit', env });
  if (res.status !== 0 || !fs.existsSync(shot)) throw new Error('capture failed (exit ' + res.status + ')');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(shot, out);
  console.log('wrote ' + out);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}
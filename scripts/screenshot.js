#!/usr/bin/env node
'use strict';

// Regenerate docs/screenshot.png with the project's standard capture recipe.
//
//   npm run screenshot
//
// The recipe (this script is the source of truth; AGENTS.md → "Screenshots"):
//
//   * 300 px wide (height follows from the modules below)
//   * CSP slots: foreground #B1DAD1, background #E9BFDB
//   * module sizes match the Settings preview defaults: CSP Color ~40 px, OKLCH
//     Slider ~90 px, Color History three rows, OKLCH Slice all three panels
//   * slider thickness 50%
//   * the only colour profile ever shown is Adobe RGB (1998) — the script seeds
//     a throwaway userData with exactly that profile, so nothing personal (or
//     any other profile) can reach the capture
//
// It talks to scripts/fake-host.js instead of Clip Studio Paint, so it is
// deterministic and needs no CSP (and no other profile can leak into the shot).

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshot.png');
const PORT = 46123;
const WIDTH = 300;
const HEIGHT = 900;
const TILE = 24;

/**
 * The recipe shows Adobe RGB (1998) and nothing else. Find it on the build
 * machine (Windows ships it) and refuse to capture if it is missing, so no other
 * profile can ever end up in the screenshot.
 */
function adobeRgbProfile() {
  const Proof = require('../src/shared/proof');
  const dir = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'spool', 'drivers', 'color');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return ''; }
  // Use the app's own picker, so the recipe matches what a first run resolves.
  const name = typeof Proof.pickAdobeRgbProfileName === 'function'
    ? Proof.pickAdobeRgbProfileName(names)
    : names.find((n) => /adobe\s*rgb\s*\(?1998\)?/i.test(n));
  return name ? path.join(dir, name) : '';
}

/** Pastels spanning the hue wheel, newest first (the history is newest first). */
function pastelHistory(count = 33) {
  const Color = require('../src/shared/color');
  const out = [];
  for (let i = 0; i < count; i++) {
    const h = (i * (360 / count) + 8) % 360;
    const rgb = Color.oklchToRgb(0.86, 0.055, h);
    out.push({
      r: Math.round(rgb.r * 255),
      g: Math.round(rgb.g * 255),
      b: Math.round(rgb.b * 255),
    });
  }
  // Newest first: reverse so the wheel reads left-to-right when drawn.
  return out.reverse();
}

function write(dir, name, value) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function main() {
  const adobe = adobeRgbProfile();
  if (!adobe) {
    console.error('Adobe RGB (1998) was not found in the Windows colour directory.');
    console.error('The screenshot recipe only ever demonstrates that profile — install it and retry.');
    process.exit(1);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iroiroppa-shot-'));
  const userData = path.join(tmp, 'user-data');
  fs.mkdirSync(path.join(userData, 'modules'), { recursive: true });

  // settings.json first, so the legacy-data migration cannot copy a user's real
  // settings (and their profile choice) in.
  write(userData, 'settings.json', {
    liveSync: true,
    autoHide: true,
    autoConnect: false,
    crosshair: true,
    showModebar: true,
    hideModuleNames: false,
    locked: false,
    proofProfile: adobe, // Adobe RGB (1998) — the only profile this recipe shows
    proofProfiles: [adobe],
    proofModel: 'working',
    proofMode: 'proof',
    cspDataDir: '',
    uiScale: 1,
    theme: 'default-light',
    accents: {},
    launchAtLogin: false,
    colorHistory: pastelHistory(),
    windowSize: { width: WIDTH, height: HEIGHT },
  });
  write(userData, 'session.json', JSON.stringify({
    url: 'https://companion.clip-studio.com/rc/en-us?s=00',
    ips: ['127.0.0.1'],
    port: PORT,
    generation: 'G#1:2022.12',
    password: 'screenshot',
  }));
  write(userData, 'layout.json', {
    version: 1,
    columns: [{
      id: 'c1',
      width: null,
      // Ratios, not weights: a locked-ratio module's height is its column width
      // times the ratio (docs/LAYOUT.md, "Height modes"), and the palette fits its
      // content, so the column adds up to the 900px the recipe asks for at 300 wide.
      // Measured at 294px of content width: 35 + 559 + 106 + 100 + the two one-row
      // modules + 26px of window chrome = 900. Changing any module or ratio here
      // changes the captured height, so re-measure rather than assuming.
      modules: [
        { instanceId: 'i1', moduleId: 'csp-color' },
        { instanceId: 'i2', moduleId: 'color-slices', ratio: 1.9 },
        { instanceId: 'i3', moduleId: 'color-slider', ratio: 0.36 },
        { instanceId: 'i4', moduleId: 'color-history', ratio: 0.34 },
      ],
    }],
    floats: [],
  });
  write(userData, 'modules/color-slider.json', {
    version: 3,
    settings: { showL: true, showC: true, showH: true, thickness: 50, hideNumbers: false },
  });
  write(userData, 'modules/color-history.json', { version: 2, settings: { tile: TILE } });

  // A host that reports exactly the colours the recipe asks for.
  const host = spawn(process.execPath, [
    path.join(ROOT, 'scripts', 'fake-host.js'), 'main', String(PORT),
    '--main', '#B1DAD1', '--sub', '#E9BFDB',
  ], { cwd: ROOT, stdio: 'ignore' });

  // Run Electron's binary directly (no shell): the repo path contains spaces,
  // and `shell: true` would split it.
  const electron = process.platform === 'win32'
    ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');
  const shot = path.join(tmp, 'shot.png');
  // Some shells (an agent harness, an IDE) export ELECTRON_RUN_AS_NODE, which makes
  // electron.exe behave as plain Node — no `electron` module, no window, no capture.
  // Strip it for the child so the app actually starts.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const res = spawnSync(electron, [
      '.', `--user-data-dir=${userData}`,
      '--shot', shot, '--size', `${WIDTH}x${HEIGHT}`, '--shot-wait', '5000',
    ], { cwd: ROOT, stdio: 'inherit', env });
    if (res.status !== 0 || !fs.existsSync(shot)) {
      throw new Error(`capture failed (exit ${res.status})`);
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.copyFileSync(shot, OUT);
    console.log(`wrote ${path.relative(ROOT, OUT)} (${WIDTH}x${HEIGHT})`);
  } finally {
    host.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

main();

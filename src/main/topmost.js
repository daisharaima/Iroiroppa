'use strict';

// The native window band for every window that floats over Clip Studio Paint.
//
// Every such window is created with `alwaysOnTop: true` and, on a healthy runtime,
// Chromium puts it in the WS_EX_TOPMOST band itself. On Windows 11 build 26300
// (after the 21 Oct 2026 updates) it does not: `setAlwaysOnTop(true)` leaves
// `isAlwaysOnTop()` false and the window sits at the bottom of the z-order.
//
// The same breakage has a second half, which is why this module now also applies
// WS_EX_NOACTIVATE: a click on a window Chromium considers *non-activatable* never
// reaches the page there (the move and the release do; only the press is lost, so
// the palette paints and follows CSP but cannot be clicked). The palette is
// therefore created activatable — `focusable: true`, so Chromium delivers the
// press — and kept out of the activation path natively instead, which is exactly
// the "clicking the palette never steals focus from CSP" behaviour the app needs.
//
// Chromium rewrites the extended style whenever it tries to activate the window,
// which drops the topmost bit; so main re-applies the band after every show and
// after every press (src/main/windows.js). One long-lived `topmost.ps1 -Watch`
// applies those repairs: spawning a PowerShell per press was slow, and its hidden
// console could briefly take the foreground, which made the auto-hide watcher hide
// the palette ("it disappears and reappears on click").

const path = require('node:path');
const { spawn } = require('node:child_process');

/** PowerShell cannot read inside app.asar; the script is asar-unpacked. */
function scriptPath(dir = __dirname) {
  const base = dir.includes('app.asar') ? dir.replace('app.asar', 'app.asar.unpacked') : dir;
  return path.join(base, 'topmost.ps1');
}

/**
 * The window's native handle as a decimal string. `getNativeWindowHandle()`
 * returns a little-endian pointer-sized Buffer (8 bytes on x64, 4 on ia32).
 */
function hwndFromBuffer(buf) {
  if (!buf || typeof buf.length !== 'number') return '';
  if (buf.length >= 8) return buf.readBigUInt64LE(0).toString();
  if (buf.length >= 4) return String(buf.readUInt32LE(0));
  return '';
}

function hwndOf(win) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return '';
  if (typeof win.getNativeWindowHandle !== 'function') return '';
  try { return hwndFromBuffer(win.getNativeWindowHandle()); } catch { return ''; }
}

/**
 * A band client: one `topmost.ps1 -Watch` child for the session, fed with
 * `hwnd|noActivate|topmost` lines. When the child cannot be started (or dies) it
 * falls back to the one-shot spawn, throttled per handle so a fallback cannot
 * spawn on every press.
 */
function createBand({ spawnFn = spawn, script = scriptPath(), throttleMs = 1200 } = {}) {
  let child = null;
  let brokenAt = 0;
  const oneShotAt = new Map();

  function spawnHelper() {
    if (Date.now() - brokenAt < 30_000) return null;
    try {
      const proc = spawnFn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script, '-Hwnd', '0', '-Watch', '1',
      ], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
      proc.on('error', () => { brokenAt = Date.now(); if (child === proc) child = null; });
      proc.on('exit', () => { if (child === proc) child = null; });
      if (proc.stdin) proc.stdin.on('error', () => { /* the child went away; the next call falls back */ });
      child = proc;
      return proc;
    } catch {
      brokenAt = Date.now();
      child = null;
      return null;
    }
  }

  /** Send one band request to the helper. False when there is no usable helper. */
  function send(hwnd, noActivate, topmost, zorder = true) {
    const proc = child || spawnHelper();
    if (!proc || !proc.stdin || proc.stdin.destroyed) return false;
    try {
      proc.stdin.write(`${hwnd}|${noActivate ? 1 : 0}|${topmost ? 1 : 0}|${zorder ? 1 : 0}\n`);
      return true;
    } catch {
      return false;
    }
  }

  function oneShot(hwnd, noActivate, topmost, now, zorder = true) {
    const last = oneShotAt.get(hwnd);
    if (last != null && now - last < throttleMs) return Promise.resolve(true);
    oneShotAt.set(hwnd, now);
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
      try {
        const proc = spawnFn('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', script,
          '-Hwnd', hwnd,
          '-NoActivate', noActivate ? '1' : '0',
          '-Topmost', topmost ? '1' : '0',
          '-Zorder', zorder ? '1' : '0',
        ], { windowsHide: true, stdio: 'ignore' });
        proc.on('error', () => done(false));
        proc.on('exit', (code) => done(code === 0));
      } catch {
        done(false);
      }
    });
  }

  async function apply(win, { noActivate = true, topmost = true, zorder = true, now = Date.now() } = {}) {
    const hwnd = hwndOf(win);
    if (!hwnd) return false;
    if (send(hwnd, noActivate, topmost, zorder)) return true;
    return oneShot(hwnd, noActivate, topmost, now, zorder);
  }

  /** Close the helper (app quit). */
  function stop() {
    if (!child) return;
    const proc = child;
    child = null;
    try { if (proc.stdin) proc.stdin.end(); } catch { /* already gone */ }
    try { proc.kill(); } catch { /* already gone */ }
  }

  return { apply, send, stop };
}

const defaultBand = createBand();

/**
 * Put `win` in the band the palette design needs: in the topmost band (so it floats
 * over Clip Studio Paint) and out of the activation path (so a click never takes
 * focus from it). Resolves true when the request was delivered.
 *
 * `noActivate: false` is for the windows that *should* take focus — the Settings
 * window, and the palette while a text field is being edited.
 */
function ensureBand(win, opts = {}) {
  return defaultBand.apply(win, opts);
}

/** Topmost only, for a window that is allowed to take focus (the Settings window). */
function ensureTopmost(win, opts = {}) {
  return ensureBand(win, { ...opts, noActivate: false, topmost: true });
}

/** Let the next fallback spawn for that handle run even inside the throttle. */
function forgetBand(win) {
  // The helper path is not throttled; only the one-shot fallback keeps a memo, and
  // it is per-call state inside the client. Nothing else to clear.
  return hwndOf(win) || '';
}

/** Kill the helper process (app quit). */
function stopBand() {
  defaultBand.stop();
}

module.exports = {
  ensureBand, ensureTopmost, forgetBand, stopBand, createBand, hwndFromBuffer, scriptPath,
};

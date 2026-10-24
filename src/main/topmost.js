'use strict';

// A topmost fallback for the rare Windows where Chromium's own request is dropped.
//
// Every window that must float above Clip Studio Paint is created with
// `alwaysOnTop: true` and re-asserted with `setAlwaysOnTop(true, 'floating')`.
// On a healthy runtime that is the whole story. On Windows 11 build 26300 (after
// the 21 Oct 2026 updates) Electron 38 and 44 both leave `isAlwaysOnTop()` false
// and the window never enters the WS_EX_TOPMOST band — and because our window is
// non-activating, it cannot even come forward on a click, so it sits at the bottom.
//
// A direct SetWindowPos(HWND_TOPMOST) still works there, so when the runtime says
// the window is not on top we hand its HWND to src/main/topmost.ps1 once per show.

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

// Do not spawn twice for the same show (a show calls this from two places).
let lastHwnd = '';
let lastAt = 0;

/**
 * Ensure `win` is in the topmost band. Resolves true when the window already
 * reports itself on top (the normal case), or when the fallback ran; false when
 * there was nothing to do or the fallback failed.
 */
function ensureTopmost(win, { spawnFn = spawn, now = Date.now(), script = scriptPath(), throttleMs = 1500 } = {}) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return Promise.resolve(false);
  if (typeof win.isAlwaysOnTop === 'function' && win.isAlwaysOnTop()) return Promise.resolve(true);
  if (typeof win.getNativeWindowHandle !== 'function') return Promise.resolve(false);
  let hwnd = '';
  try { hwnd = hwndFromBuffer(win.getNativeWindowHandle()); } catch { return Promise.resolve(false); }
  if (!hwnd) return Promise.resolve(false);
  if (hwnd === lastHwnd && now - lastAt < throttleMs) return Promise.resolve(true);
  lastHwnd = hwnd;
  lastAt = now;
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    try {
      const proc = spawnFn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script, '-Hwnd', hwnd,
      ], { windowsHide: true, stdio: 'ignore' });
      proc.on('error', () => done(false));
      proc.on('exit', (code) => done(code === 0));
    } catch {
      done(false);
    }
  });
}

module.exports = { ensureTopmost, hwndFromBuffer, scriptPath };

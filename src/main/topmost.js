'use strict';

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
function createBand({ spawnFn = spawn, script = scriptPath(), throttleMs = 1200, host = null, health = null } = {}) {
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
      if (proc.stdin) proc.stdin.on('error', () => {  });
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

    if (host) {

      if (!host.available) await host.whenReady(400);
      if (host.available) {
        try {
          const reply = await host.topmost(hwnd, { noActivate, topmost, zorder });
          if (reply && reply.applied === 1) { if (health) health.set('band', 'host'); return true; }
        } catch {

        }
      }
    }

    if (send(hwnd, noActivate, topmost, zorder)) { if (health) health.set('band', 'ps'); return true; }
    const ok = await oneShot(hwnd, noActivate, topmost, now, zorder);
    if (health) health.set('band', ok ? 'ps' : 'down');
    return ok;
  }

  /** Close the helper (app quit). */
  function stop() {
    if (!child) return;
    const proc = child;
    child = null;
    try { if (proc.stdin) proc.stdin.end(); } catch {  }
    try { proc.kill(); } catch {  }
  }

  /** Point this client at the native host (or null to go back to PowerShell). */
  function setHealth(next) {
    health = next || null;
  }

  function setHost(next) {
    host = next || null;

    if (host && child) {
      const proc = child;
      child = null;
      try { if (proc.stdin) proc.stdin.end(); } catch {  }
      try { proc.kill(); } catch {  }
    }
  }

  return { apply, send, stop, setHost, setHealth };
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

  return hwndOf(win) || '';
}

/** Route the default band through the native host (or null for PowerShell). */
function setBandHost(host) {
  defaultBand.setHost(host);
}

/** Route the default band's health reporting (see helper-health.js). */
function setBandHealth(health) {
  defaultBand.setHealth(health);
}

/** Kill the helper process (app quit). */
function stopBand() {
  defaultBand.stop();
}

module.exports = {
  ensureBand, ensureTopmost, forgetBand, stopBand, setBandHost, setBandHealth, createBand, hwndFromBuffer, scriptPath,
};

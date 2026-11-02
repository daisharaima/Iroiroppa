'use strict';

// Runs pointer.ps1, which reports left-button down/up over Clip Studio Paint
// (pen and mouse). `down` carries whether the point is CSP's canvas and whether
// Alt was held; History uses it for the drawing-only gate. `up` is the pick end.
//
// If the helper cannot start or dies, it is retried; meanwhile history falls back
// to the recorder's settle, so a pick is still recorded, just on the timer.

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

// PowerShell cannot read inside app.asar; `asarUnpack` puts the helper in
// app.asar.unpacked, and the child must be given that real path.
function pointerScript() {
  const dir = __dirname.includes('app.asar')
    ? __dirname.replace('app.asar', 'app.asar.unpacked')
    : __dirname;
  return path.join(dir, 'pointer.ps1');
}

class PointerWatcher extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.buffer = '';
    this.stopped = true;
    this.retry = null;
    this.host = null;
  }

  /**
   * Take mouse events from the native host. It already filters to CSP and computes
   * the canvas flag, so the watcher becomes a thin adapter and the 57 MB PowerShell
   * process disappears.
   */
  attach(host, health = null) {
    if (!host) return;
    this.host = host;
    this.hostRef = host;
    this.health = health;
    host.on('hook', (message) => {
      // A hook that failed to install looks exactly like "the user is not clicking",
      // so a refusal has to be surfaced: the caller then falls back to PowerShell.
      if (!message || message.hook !== 0) return;
      this.host = null;
      this.emit('host-lost');
      this._spawnPowerShell();
    });
    host.on('mouse', (message) => {
      if (!message) return;
      if (this.health) this.health.set('pointer', 'host');
      if (message.mouse === 'up') { this.emit('up'); return; }
      if (message.mouse !== 'down') return;
      this.emit('down', {
        canvas: message.canvas === true,
        alt: message.alt === true,
        ctrl: message.ctrl === true,
        shift: message.shift === true,
      });
    });
  }

  start() {
    if (this.proc || this.stopped === false) return;
    this.stopped = false;

    // A host that is still starting must win the race: spawning PowerShell here would
    // leave a 57 MB helper alive for the session even after the host came up.
    if (this.host) {
      const host = this.host;
      host.whenReady(600).then((ok) => {
        if (this.stopped) return;
        if (ok && host.available) {
          host.setMouse(true).catch(() => {});
          if (this.health) this.health.set('pointer', 'host');
          return;
        }
        this._spawnPowerShell();
      });
      return;
    }

    this._spawnPowerShell();
  }

  _spawnPowerShell() {
    if (this.stopped || this.proc) return;
    // Two implementations of one capability must never run together.
    if (this.hostRef && this.hostRef.available) this.hostRef.setMouse(false).catch(() => {});
    let proc;
    try {
      proc = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', pointerScript(),
        '-ParentPid', String(process.pid),
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      this._scheduleRetry();
      return;
    }
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => this._onData(chunk));
    const gone = () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.buffer = '';
      this._scheduleRetry();
    };
    proc.on('error', gone);
    proc.on('exit', gone);
    if (this.health) this.health.set('pointer', 'ps');
  }

  _scheduleRetry() {
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; this.start(); }, 5000);
    this.retry.unref?.();
  }

  _onData(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let info;
      try { info = JSON.parse(line); } catch { continue; }
      if (!info) continue;
      if (info.event === 'up') this.emit('up');
      else if (info.event === 'down') this.emit('down', {
        canvas: info.canvas === true,
        alt: info.alt === true,
        ctrl: info.ctrl === true,
        shift: info.shift === true,
      });
    }
  }

  /** Try to move back to the host after a fallback (bounded retry, see main.js). */
  retryHost() {
    if (!this.hostRef || !this.hostRef.available) return false;
    this.host = this.hostRef;
    const proc = this.proc;
    this.proc = null;
    if (proc) { try { proc.kill(); } catch { /* gone */ } }
    this.hostRef.setMouse(true).catch(() => {});
    if (this.health) this.health.set('pointer', 'host');
    return true;
  }

  stop() {
    this.stopped = true;
    if (this.host) this.host.setMouse(false).catch(() => {});
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    const proc = this.proc;
    this.proc = null;
    this.buffer = '';
    if (proc) {
      try { proc.kill(); } catch { /* already gone */ }
    }
  }
}

module.exports = { PointerWatcher };

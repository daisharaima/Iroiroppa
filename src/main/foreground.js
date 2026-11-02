'use strict';

// Tracks the Windows foreground process so the palette can appear only while
// Clip Studio Paint is active. One long-lived PowerShell process polls the
// foreground window and streams the process name; we never respawn per poll.

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

// PowerShell cannot read inside app.asar; asarUnpack puts the script in
// app.asar.unpacked, and the child must be launched from that real path.
function foregroundScript() {
  const dir = __dirname.includes('app.asar')
    ? __dirname.replace('app.asar', 'app.asar.unpacked')
    : __dirname;
  return path.join(dir, 'foreground.ps1');
}

class ForegroundWatcher extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.current = null;
    this.buffer = '';
    this.stopped = true;
    this.restartDelay = 1000;
    this._restartTimer = null;
    this._refreshAt = 0;
    this._refreshName = '';
    this._refreshPromise = null;
    this._refreshProc = null;
    this.host = null;
  }

  /**
   * Take foreground events from the native host instead of spawning PowerShell.
   * The host is event-driven (SetWinEventHook) and answers `refresh()` with one
   * IPC line, so the 5 s one-shot query and its 1.24 s process never exist.
   */
  attach(host, health = null) {
    if (!host) return;
    this.host = host;
    this.hostRef = host;
    this.health = health;
    host.on('fg', (message) => {
      if (this.health) this.health.set('foreground', 'host');
      const name = message && message.fg ? String(message.fg) : '';
      if (!name || name === this.current) return;
      this.current = name;
      this.emit('change', name);
    });
    host.on('exit', () => this.emit('down'));
  }

  detach() {
    this.host = null;
  }

  start() {
    if (this.proc) return;
    this.stopped = false;
    if (this.host) {
      // One IPC line, no process; the hook reports the current app immediately.
      this.host.setForeground(true).catch(() => {});
      return;
    }
    this._spawn();
  }

  /** The PowerShell command line used by the long-lived watcher and the one-shot. */
  _args(extra = []) {
    return [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', foregroundScript(), ...extra,
    ];
  }

  _spawn() {
    if (this.stopped || this.proc) return;
    // Never run two implementations of one capability.
    if (this.hostRef && this.hostRef.available) this.hostRef.setForeground(false).catch(() => {});
    const proc = spawn('powershell.exe', this._args(), {
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => this._onData(chunk));
    proc.on('error', () => this._onProcGone(proc));
    proc.on('exit', () => this._onProcGone(proc));
    if (this.health) this.health.set('foreground', 'ps');
  }

  /**
   * Ask the *current* foreground, once. The stream can be a few hundred ms stale
   * (or wrong after a watcher hiccup); the hide decision re-checks this before it
   * hides anything, so CSP-focused can never be hidden by a stale line.
   * Concurrent calls share one query and a 250 ms cache; failures resolve ''.
   */
  refresh() {
    // The host answers in ~1 ms and cannot be stale in the way a stream is: it
    // reads GetForegroundWindow on demand.
    if (this.host && this.host.available) {
      return this.host.foreground()
        .then((reply) => (reply && reply.fgname) || '')
        .catch(() => '');
    }
    if (this._refreshPromise) return this._refreshPromise;
    if (Date.now() - this._refreshAt < 250) return Promise.resolve(this._refreshName);
    this._refreshPromise = new Promise((resolve) => {
      let out = '';
      let done = false;
      let timer = null;
      const proc = spawn('powershell.exe', this._args(['-Once']), {
        windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      });
      this._refreshProc = proc;
      const finish = (name) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        this._refreshProc = null;
        this._refreshAt = Date.now();
        this._refreshName = name;
        this._refreshPromise = null;
        resolve(name);
      };
      timer = setTimeout(() => {
        try { proc.kill(); } catch { /* already gone */ }
        finish('');
      }, 3000);
      timer.unref?.();
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => { out += chunk; });
      proc.on('error', () => finish(''));
      proc.on('exit', () => {
        const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        finish(lines.length ? lines[lines.length - 1] : '');
      });
    });
    return this._refreshPromise;
  }

  /** Try to move back to the host after a fallback (bounded retry, see main.js). */
  retryHost() {
    if (!this.hostRef || !this.hostRef.available) return false;
    const proc = this.proc;
    this.proc = null;
    if (proc) { try { proc.kill(); } catch { /* gone */ } }
    this.host = this.hostRef;
    this.hostRef.setForeground(true).catch(() => {});
    if (this.health) this.health.set('foreground', 'host');
    return true;
  }

  /** Respawn after a crash so visibility tracking recovers without a restart. */
  _onProcGone(proc) {
    if (this.proc !== proc) return;
    this.proc = null;
    // The watcher is not authoritative while it is down: the visibility policy
    // must keep the palette rather than fall back to blur-hiding.
    this.emit('down');
    if (this.stopped || this._restartTimer) return;
    const delay = this.restartDelay;
    this.restartDelay = Math.min(this.restartDelay * 2, 15000);
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      this._spawn();
    }, delay);
    this._restartTimer.unref?.();
  }

  _onData(chunk) {
    this.restartDelay = 1000; // the watcher is healthy again
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line && line !== this.current) {
        this.current = line;
        this.emit('change', line);
      }
    }
  }

  stop() {
    this.stopped = true;
    if (this.host) this.host.setForeground(false).catch(() => {});
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    const proc = this.proc;
    this.proc = null;
    this.buffer = '';
    this.current = null;
    if (proc) {
      try { proc.kill(); } catch { /* already gone */ }
    }
    if (this._refreshProc) {
      try { this._refreshProc.kill(); } catch { /* already gone */ }
      this._refreshProc = null;
    }
    this._refreshPromise = null;
    this._refreshAt = 0;
    this._refreshName = '';
  }
}

module.exports = { ForegroundWatcher };

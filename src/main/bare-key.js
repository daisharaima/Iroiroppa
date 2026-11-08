'use strict';

// Bare-key helper (bare-keys.ps1). A bare letter cannot be a RegisterHotKey or a
// globalShortcut without swallowing typing everywhere; the PowerShell helper
// installs a low-level hook, applies a native typing guard, and only blocks the
// key when main says the foreground is ours and the guard says the user is not
// typing. Main sends `active`/`typing` state over stdin.

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn: defaultSpawn } = require('node:child_process');
const Match = require('../shared/shortcut-match');

function scriptPath() {
  const dir = __dirname.includes('app.asar')
    ? __dirname.replace('app.asar', 'app.asar.unpacked')
    : __dirname;
  return path.join(dir, 'bare-keys.ps1');
}

function buildArgs(accel, { script = scriptPath(), parentPid = process.pid } = {}) {
  const parsed = Match.parseAccelerator(accel);
  if (!parsed.vk || !parsed.hook) return null;
  return [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Vk', String(parsed.vk), '-ParentPid', String(parentPid),
  ];
}

class BareKeyWatcher extends EventEmitter {
  constructor({ accel, spawn = defaultSpawn, script, parentPid = process.pid } = {}) {
    super();
    this.accel = String(accel || '');
    this.spawn = spawn;
    this.script = script || scriptPath();
    this.parentPid = parentPid;
    this.proc = null;
    this.buffer = '';
    this.stopped = true;
    this.ready = false;
    this.active = true;
    this.typing = false;
    /** Only claim the key while the pointer is over CSP's canvas. */
    this.canvas = false;
    this.host = null;
    this.vk = 0;
  }

  /**
   * Watch the binding through the native host instead of spawning bare-keys.ps1.
   * The host owns one keyboard hook for every binding; this object filters by vk and
   * keeps the same active/typing contract main already pushes.
   */
  attach(host, vk, health = null) {
    if (!host || !vk) return false;
    this.host = host;
    this.hostRef = host;
    this.health = health;
    this.vk = Number(vk);
    host.on('key', (message) => {
      if (!message || Number(message.vk) !== this.vk) return;
      if (this.health) this.health.set('keys', 'host');
      if (message.key === 'down') this.emit('down');
      else if (message.key === 'up') this.emit('up');
    });
    host.on('exit', () => { if (this.host === host) this.emit('gone'); });
    host.on('keyhook', (message) => {
      if (!message || message.keyhook !== 0) return;
      // The host could not install a keyboard hook: stop claiming the binding and let
      // the caller fall back, or the shortcut silently stops working.
      this.host = null;
      this.emit('failed', 'hook-unavailable');
      this._spawnPowerShell();
    });
    return true;
  }

  /** Gate this binding on the pointer being over CSP's canvas. */
  setCanvas(value) {
    this.canvas = Boolean(value);
    if (this.host && this.vk) {
      this.host.keyCanvas(this.vk, this.canvas).catch(() => {});
    }
    // The PowerShell helper has no canvas check; a re-registration is pointless there,
    // so the flag simply means "not gated" until the host is back.
  }

  start() {
    if (this.proc || this.stopped === false) return false;

    if (this.host) {
      // The host is asynchronous: wait for it rather than racing into PowerShell.
      const host = this.host;
      this.stopped = false;
      host.whenReady(600).then((ok) => {
        if (this.stopped) return;
        if (ok && host.available) {
          this.ready = true;
          this.emit('ready');
          host.addKey(this.vk, this.active, this.typing, this.canvas).catch(() => {});
          if (this.health) this.health.set('keys', 'host');
          return;
        }
        // The host is not serving this session: use the PowerShell helper rather than
        // dropping the user's shortcut.
        this.host = null;
        this._spawnPowerShell();
      });
      return true;
    }
    const args = buildArgs(this.accel, { script: this.script, parentPid: this.parentPid });
    if (!args) return false;
    this.stopped = false;
    this.buffer = '';
    try {
      this.proc = this.spawn('powershell.exe', args, {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      this.stopped = true;
      return false;
    }
    if (!this.proc) { this.stopped = true; return false; }
    if (this.proc.stdout) {
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    }
    this.proc.on('error', () => { this.stopped = true; this.proc = null; this.emit('gone'); });
    this.proc.on('exit', () => {
      const wasReady = this.ready;
      this.ready = false;
      this.proc = null;
      this.stopped = true;
      if (wasReady) this.emit('gone');
    });
    this.setActive(this.active);
    this.setTyping(this.typing);
    return true;
  }

  /** The PowerShell helper, used when no native host is available. */
  _spawnPowerShell() {
    if (this.proc) return;
    if (this.hostRef && this.hostRef.available) this.hostRef.keyOff(this.vk).catch(() => {});
    const args = buildArgs(this.accel, { script: this.script, parentPid: this.parentPid });
    if (!args) { this.stopped = true; this.emit('failed', 'unavailable'); return; }
    this.stopped = false;
    this.buffer = '';
    try {
      this.proc = this.spawn('powershell.exe', args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch {
      this.stopped = true;
      this.emit('failed', 'unavailable');
      return;
    }
    if (!this.proc) { this.stopped = true; this.emit('failed', 'unavailable'); return; }
    if (this.proc.stdout) {
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    }
    this.proc.on('error', () => { this.stopped = true; this.proc = null; this.emit('gone'); });
    this.proc.on('exit', () => {
      const wasReady = this.ready;
      this.ready = false;
      this.proc = null;
      this.stopped = true;
      if (wasReady) this.emit('gone');
    });
    this.setActive(this.active);
    this.setTyping(this.typing);
    if (this.health) this.health.set('keys', 'ps');
  }

  _onData(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let info = null;
      try { info = JSON.parse(line); } catch { continue; }
      if (!info || !info.event) continue;
      if (info.event === 'ready') { this.ready = true; this.emit('ready'); }
      else if (info.event === 'down') this.emit('down');
      else if (info.event === 'up') this.emit('up');
      else if (info.event === 'unavailable' || info.event === 'taken') {
        this.emit('failed', info.event);
      }
    }
  }

  _write(line) {
    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) return false;
    try { this.proc.stdin.write(`${line}\n`); return true; } catch { return false; }
  }

  setActive(active) {
    this.active = Boolean(active);
    if (this.host) {
      this.host.keyActive(this.vk, this.active).catch(() => {});
      return true;
    }
    return this._write(`active ${this.active ? 1 : 0}`);
  }

  setTyping(typing) {
    this.typing = Boolean(typing);
    if (this.host) {
      this.host.keyTyping(this.vk, this.typing).catch(() => {});
      return true;
    }
    return this._write(`typing ${this.typing ? 1 : 0}`);
  }

  /** Try to move back to the host after a fallback. */
  retryHost() {
    if (!this.hostRef || !this.hostRef.available) return false;
    if (this.proc) { try { this.proc.kill(); } catch { /* gone */ } this.proc = null; }
    this.host = this.hostRef;
    this.hostRef.addKey(this.vk, this.active, this.typing).catch(() => {});
    if (this.health) this.health.set('keys', 'host');
    return true;
  }

  stop() {
    if (this.host) {
      this.host.keyOff(this.vk).catch(() => {});
      this.stopped = true;
      this.ready = false;
      return;
    }
    if (!this.proc) { this.stopped = true; return; }
    this._write('quit');
    try { this.proc.kill(); } catch { /* already gone */ }
    this.proc = null;
    this.ready = false;
    this.stopped = true;
  }
}

module.exports = { BareKeyWatcher, buildArgs, scriptPath };

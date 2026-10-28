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
  }

  start() {
    if (this.proc || this.stopped === false) return false;
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
    return this._write(`active ${this.active ? 1 : 0}`);
  }

  setTyping(typing) {
    this.typing = Boolean(typing);
    return this._write(`typing ${this.typing ? 1 : 0}`);
  }

  stop() {
    if (!this.proc) { this.stopped = true; return; }
    this._write('quit');
    try { this.proc.kill(); } catch { /* already gone */ }
    this.proc = null;
    this.ready = false;
    this.stopped = true;
  }
}

module.exports = { BareKeyWatcher, buildArgs, scriptPath };

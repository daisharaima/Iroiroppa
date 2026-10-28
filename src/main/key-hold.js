'use strict';

// A hold-to-show binding runs in its own PowerShell process (keys.ps1), because
// Electron's globalShortcut has no key-up event. This wrapper spawns, parses the
// one-line JSON events, and exposes a small EventEmitter:
//
//   ready  — RegisterHotKey took, the chord is now owned (and swallowed)
//   down   — the chord went down
//   up     — the key or a modifier was released
//   taken  — another app owns the chord
//   gone   — the helper exited (a stuck hold must be released by the caller)
//
// `spawn` is injectable so the stream can be tested without Windows or PowerShell.

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn: defaultSpawn } = require('node:child_process');
const Match = require('../shared/shortcut-match');

// PowerShell cannot read inside app.asar; electron-builder unpacks src/main/*.ps1.
function scriptPath() {
  const dir = __dirname.includes('app.asar')
    ? __dirname.replace('app.asar', 'app.asar.unpacked')
    : __dirname;
  return path.join(dir, 'keys.ps1');
}

/** The `keys.ps1` arguments for an accelerator, or null when it is unusable. */
function buildArgs(accel, { check = false, script = scriptPath() } = {}) {
  const parsed = Match.parseAccelerator(accel);
  if (!parsed.ok) return null;
  const mods = (parsed.alt ? 1 : 0) | (parsed.ctrl ? 2 : 0)
    | (parsed.shift ? 4 : 0) | (parsed.super ? 8 : 0);
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Vk', String(parsed.vk), '-Mods', String(mods),
  ];
  if (check) args.push('-Check');
  return args;
}

class KeyHoldWatcher extends EventEmitter {
  constructor({ accel, spawn = defaultSpawn, script } = {}) {
    super();
    this.accel = String(accel || '');
    this.spawn = spawn;
    this.script = script || scriptPath();
    this.proc = null;
    this.buffer = '';
    this.stopped = true;
    this.ready = false;
  }

  /** Start the helper. Returns false when the chord cannot be expressed. */
  start() {
    if (this.proc || this.stopped === false) return this.stopped === false;
    const args = buildArgs(this.accel, { script: this.script });
    if (!args) return false;
    this.stopped = false;
    let proc;
    try {
      proc = this.spawn('powershell.exe', args, {
        windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      this.stopped = true;
      return false;
    }
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => this._onData(chunk));
    const gone = () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.buffer = '';
      const wasReady = this.ready;
      this.ready = false;
      this.stopped = true;
      this.emit('gone', { ready: wasReady });
    };
    proc.on('error', gone);
    proc.on('exit', gone);
    return true;
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
      if (!info || typeof info.event !== 'string') continue;
      if (info.event === 'ready') { this.ready = true; this.emit('ready'); }
      else if (info.event === 'down') this.emit('down');
      else if (info.event === 'up') this.emit('up');
      else if (info.event === 'taken') { this.ready = false; this.emit('taken'); }
    }
  }

  stop() {
    this.stopped = true;
    this.ready = false;
    const proc = this.proc;
    this.proc = null;
    this.buffer = '';
    if (proc) {
      try { proc.kill(); } catch { /* already gone */ }
    }
  }
}

/**
 * Ask `keys.ps1 -Check` whether the chord can be registered right now. Used
 * before persisting a hold binding so a taken key is never remembered as if it
 * worked. Resolves `{ ok, error }`; a timeout is `unavailable`.
 */
function checkHoldAccel(accel, { spawn = defaultSpawn, script, timeoutMs = 4000 } = {}) {
  const args = buildArgs(accel, { check: true, script: script || scriptPath() });
  if (!args) return Promise.resolve({ ok: false, error: 'invalid' });
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('powershell.exe', args, {
        windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolve({ ok: false, error: 'unavailable' });
      return;
    }
    let buffer = '';
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { proc.kill(); } catch { /* already exited */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'unavailable' }), timeoutMs);
    if (timer.unref) timer.unref();
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let info;
        try { info = JSON.parse(line); } catch { continue; }
        if (info && info.event === 'ready') { finish({ ok: true }); return; }
        if (info && info.event === 'taken') { finish({ ok: false, error: 'taken' }); return; }
      }
    });
    proc.on('error', () => finish({ ok: false, error: 'unavailable' }));
    proc.on('exit', (code) => {
      if (!done && code !== 0) finish({ ok: false, error: code === 2 ? 'taken' : 'unavailable' });
    });
  });
}

module.exports = { KeyHoldWatcher, buildArgs, checkHoldAccel, scriptPath };

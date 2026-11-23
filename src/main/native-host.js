'use strict';

const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');

/** Restart delays, in ms: quick enough to feel instant, slow enough not to spin. */
const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000, 30000];

/** How long a request waits for its reply before the promise rejects. */
const REQUEST_TIMEOUT = 3000;

/** Commands whose reply line is matched by a key, so interleaved events cannot confuse them. */
const REPLY_KEYS = {
  ping: 'pong',
  topmost: 'topmost',
  state: 'state',
  watch: 'watching',
  unwatch: 'watching',
  mouse: 'mouseon',
  fg: 'fgon',
  foreground: 'fgname',
  key: 'keyadd',
  keyoff: 'keydel',
  keyactive: 'keyactive',
  keytyping: 'keytyping',
  keycanvas: 'keycanvas',
  keybusy: 'keybusy',
  keyobserve: 'keyobserve',
  cursor: 'cursor',
  hit: 'hit',
  move: 'moved',
  sendkey: 'sent',
  typing: 'typing',
  version: 'version',
};

class NativeHost extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.exePath]      absolute path to irohost.exe
   * @param {Function} [options.spawn]      child_process.spawn (injected by tests)
   * @param {Function} [options.log]        debug sink, receives one string per line
   */
  constructor(options = {}) {
    super();
    this.exePath = options.exePath || defaultExePath();
    this.spawnImpl = options.spawn || require('node:child_process').spawn;
    this.log = options.log || null;

    this.child = null;
    this.buffer = '';
    this.pending = [];
    this.restarts = 0;
    this.stopped = false;
    this.available = false;
    this.lastError = null;
    this._restartTimer = null;
  }

  /** Why the host is not running, in words a status line can show. */
  describe() {
    if (this.available) return 'native host running';
    if (!this.exePath || !fs.existsSync(this.exePath)) return 'native host binary missing';
    if (this.lastError) return `native host: ${this.lastError}`;
    return 'native host stopped';
  }

  start() {
    if (this.child || this.stopped) return this;
    if (!this.exePath || !fs.existsSync(this.exePath)) {
      this.lastError = 'binary missing';
      this.emit('unavailable', this.describe());
      return this;
    }

    let child;
    try {
      child = this.spawnImpl(this.exePath, ['--parent', String(process.pid)], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      this.lastError = error.message;
      this.emit('unavailable', this.describe());
      return this;
    }

    this.child = child;
    this.buffer = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._onData(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (this.log) this.log(`native-host stderr: ${String(chunk).trim()}`);
    });

    child.on('error', (error) => {
      this.lastError = error.message;
      this.emit('error-line', error.message);
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      this.available = false;
      this._rejectAll('native host exited');
      this.emit('exit', { code, signal });
      if (!this.stopped) this._scheduleRestart();
    });

    return this;
  }

  stop() {
    this.stopped = true;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    const child = this.child;
    if (!child) return;
    try {
      child.stdin.write('quit\n');
    } catch {

    }
    const killTimer = setTimeout(() => {
      try { child.kill(); } catch {  }
    }, 500);
    if (killTimer.unref) killTimer.unref();
    this.child = null;
    this.available = false;
  }

  /**
   * Resolve when the helper has said "ready", or after `timeoutMs`.
   * The app calls this once at startup so a band request that races the spawn waits
   * for the host instead of falling back to a PowerShell child that would then live
   * for the whole session.
   */
  whenReady(timeoutMs = 400) {
    if (this.available) return Promise.resolve(true);
    if (this.stopped || !this.child) {

      if (!this.child) return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.off('ready', onReady);
        resolve(this.available);
      }, timeoutMs);
      if (timer.unref) timer.unref();
      const onReady = () => {
        clearTimeout(timer);
        this.off('ready', onReady);
        resolve(true);
      };
      this.once('ready', onReady);
    });
  }

  /** Send one command; resolves with its reply line (parsed), or rejects on timeout. */
  request(command) {
    const key = REPLY_KEYS[command.split(' ')[0]];
    if (!this.child) return Promise.reject(new Error('native host not running'));

    return new Promise((resolve, reject) => {
      const entry = { key, resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        this.pending = this.pending.filter((item) => item !== entry);
        reject(new Error(`native host did not answer ${command}`));
      }, REQUEST_TIMEOUT);
      if (entry.timer.unref) entry.timer.unref();
      this.pending.push(entry);
      try {
        this.child.stdin.write(`${command}\n`);
      } catch (error) {
        clearTimeout(entry.timer);
        this.pending = this.pending.filter((item) => item !== entry);
        reject(error);
      }
    });
  }

  ping() { return this.request('ping'); }
  /** Set/clear each style bit and optionally (re)enter the band. */
  topmost(hwnd, { noActivate = true, topmost = true, zorder = true } = {}) {
    return this.request(`topmost ${hwnd} ${noActivate ? 1 : 0} ${topmost ? 1 : 0} ${zorder ? 1 : 0}`);
  }
  state(hwnd) { return this.request(`state ${hwnd}`); }
  watch(hwnd, intervalMs = 100) { return this.request(`watch ${hwnd} ${intervalMs}`); }
  unwatch() { return this.request('unwatch'); }
  setMouse(enabled) { return this.request(`mouse ${enabled ? 1 : 0}`); }
  setForeground(enabled) { return this.request(`fg ${enabled ? 1 : 0}`); }

  /** Register a bare-key binding: the host hooks it and reports down/up. */
  addKey(vk, active = true, typing = false, canvas = false) {
    return this.request(`key ${vk} ${active ? 1 : 0} ${typing ? 1 : 0} ${canvas ? 1 : 0}`);
  }

  keyOff(vk) { return this.request(`keyoff ${vk}`); }
  keyActive(vk, value) { return this.request(`keyactive ${vk} ${value ? 1 : 0}`); }
  keyTyping(vk, value) { return this.request(`keytyping ${vk} ${value ? 1 : 0}`); }
  /** Claim the key only while the pointer is over CSP's canvas. */
  keyCanvas(vk, value) { return this.request(`keycanvas ${vk} ${value ? 1 : 0}`); }

  /** CSP would refuse a Quick Access command now, so pass the key through. */
  keyBusy(vk, value) { return this.request(`keybusy ${vk} ${value ? 1 : 0}`); }

  /** Report the key without swallowing it (the app below still receives it). */
  keyObserve(vk, value) { return this.request(`keyobserve ${vk} ${value ? 1 : 0}`); }

  /** Where the pointer is, and whether it is over CSP's canvas (diagnostic). */
  cursor() { return this.request('cursor'); }

  /** Put the pointer at a screen point (diagnostic, for the canvas-gate probe). */
  move(x, y) { return this.request(`move ${Math.round(x)} ${Math.round(y)}`); }

  /** Inject one keystroke by virtual-key code (diagnostic; does not touch the foreground). */
  sendKey(vk) { return this.request(`sendkey ${vk}`); }

  /** Would a press at (x, y) land on CSP's canvas? (diagnostic, never presses) */
  hit(x, y) { return this.request(`hit ${Math.round(x)} ${Math.round(y)}`); }

  /** Which typing signal (if any) sees the foreground window (diagnostic). */
  typingSignals() { return this.request('typing'); }

  /** The current foreground process name, asked once (no spawn). */
  foreground() { return this.request('foreground'); }

  _onData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this._onLine(line);
    }
  }

  _onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      if (this.log) this.log(`native-host unparsable: ${line}`);
      return;
    }

    if (this.log) this.log(`native-host: ${line}`);

    if (Object.prototype.hasOwnProperty.call(message, 'ready')) {
      this.available = true;
      this.restarts = 0;
      this.lastError = null;
      this.emit('ready', message);
      return;
    }

    if (message.error) {
      this.emit('error-line', message.error);

    }

    for (const event of ['key', 'mouse', 'fg', 'repair', 'hook', 'keyhook']) {
      if (Object.prototype.hasOwnProperty.call(message, event)) {
        this.emit(event, message);
        break;
      }
    }

    this._settle(message);
  }

  _settle(message) {
    const index = this.pending.findIndex((entry) => {
      if (!entry.key) return false;
      return Object.prototype.hasOwnProperty.call(message, entry.key);
    });
    if (index < 0) return;

    const [entry] = this.pending.splice(index, 1);
    clearTimeout(entry.timer);
    entry.resolve(message);
  }

  _rejectAll(reason) {
    const pending = this.pending.splice(0);
    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
  }

  _scheduleRestart() {
    if (this.stopped || this._restartTimer) return;
    if (this.restarts >= BACKOFF.length) {
      this.lastError = 'gave up restarting';
      this.emit('unavailable', this.describe());
      return;
    }
    const delay = BACKOFF[this.restarts++];
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (!this.stopped) this.start();
    }, delay);
    if (this._restartTimer.unref) this._restartTimer.unref();
  }
}

/**
 * Where the helper lives: beside the sources in development, inside the unpacked
 * asar in a packaged build (electron-builder's `asarUnpack`).
 */
function defaultExePath() {
  const candidates = [];
  candidates.push(path.join(__dirname, 'native', 'bin', 'irohost.exe'));

  if (__dirname.includes('app.asar')) {
    candidates.unshift(path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'native', 'bin', 'irohost.exe'));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

module.exports = { NativeHost, defaultExePath, BACKOFF, REQUEST_TIMEOUT };

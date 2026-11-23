'use strict';

const { EventEmitter } = require('node:events');
const { CompanionClient } = require('./companion/client');
const { decodeConfig, isShareUrl } = require('./companion/qr');
const { scanOnce } = require('./capture');
const { TYPE } = require('./companion/packets');
const QuickAccess = require('./companion/quick-access');
const Color = require('../shared/color');

const SCAN_TIMEOUT_MS = 90000;

const SCAN_INTERVAL_MS = 250;
const WRITE_INTERVAL_MS = 60;
const SUPPRESS_PUSH_MS = 500;

const POLL_TICK_MS = 50;
const POLL_FAST_MS = 100;
const POLL_SLOW_MS = 300;
const POLL_FAST_WINDOW_MS = 1500;

const POLL_LAG_GUARD_MS = 5000;
const WRITE_GRACE_MS = 1500;

const SYNC_IDLE_LIMIT_S = 12;
const SYNC_GATE_TICK_MS = 500;

const MAX_RECONNECT_FAILURES = 4;

const QUICK_ACCESS_TIMEOUT_MS = 4000;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

class CompanionService extends EventEmitter {
  /**
   * @param {object} deps
   * @param {object} deps.settings
   * @param {object} deps.session
   * @param {() => number} [deps.systemIdleSeconds] seconds since the last user
   *   input anywhere (injected so the service stays Electron-free; 0 = active)
   * @param {() => boolean} [deps.windowVisible] is our UI on screen?
   * @param {() => boolean} [deps.cspForeground] is CSP the foreground app?
   */
  constructor({
    settings, session,
    systemIdleSeconds = () => 0,
    windowVisible = () => true,
    cspForeground = () => true,
    decodeFrame = null,
  }) {
    super();
    this.settings = settings;
    this.session = session;

    this.decodeFrame = decodeFrame;
    this.client = null;
    this.state = 'idle';
    this.detail = '';
    this.lastColor = null;
    this.scanning = false;
    this._scanToken = 0;
    this._writeTimer = null;
    this._pendingWrite = null;
    this._previewTimer = null;
    this._preview = null;
    this._suppressUntil = 0;
    this._pollTimer = null;
    this._pollBusy = false;

    this._hostColorSeq = 0;
    this._lastChange = null;
    this._lagSeen = 0;
    this._fastUntil = 0;
    this._lastPollAt = 0;
    this._written = null;
    this._burstBase = null;
    this._recentWrites = [];
    this._reconnectFailures = 0;
    this._systemIdleSeconds = systemIdleSeconds;
    this._windowVisible = windowVisible;
    this._cspForeground = cspForeground;
    this._syncActive = true;
    this._lastGateAt = 0;
  }

  status() {
    return {
      state: this.state,
      detail: this.detail,
      connected: this.state === 'connected',
      scanning: this.state === 'scanning',
      specVersion: this.client ? this.client.serverSpecVersion : null,
      remote: this.client ? this.client.remoteAddress : null,
    };
  }

  /**
   * Invoke a CSP Quick Access command over the protocol.
   * The go/no-go for whether the protocol can replace a native sender; the sender
   * is the fallback when this returns `{ ok: false }`.
   */
  async quickAccess(index = 0) {
    if (!this.client || !this.client.alive) return { ok: false, error: 'not connected' };
    try {
      const result = await this.client.request('DoQuickAccess', { index }, { timeoutMs: 4000 });

      if (result && result.type === TYPE.ERROR) return { ok: false, error: 'command rejected by CSP' };
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Read the on/off state of CSP commands by name (docs/PROTOCOL.md, "Quick
   * Access"). The host pushes colour, never Quick Access state, so a caller polls
   * this; it is one small request even for the 40 brush sub-tool toggles.
   * @param {string[]} names CSP command names (`toolpressuretosize`, …)
   */
  async readQuickAccess(names = []) {
    const wanted = QuickAccess.cleanNames(names);
    if (!wanted.length) return { ok: false, error: 'no names' };
    if (!this.client || !this.client.alive) return { ok: false, error: 'not connected' };
    try {
      const result = await this.client.request(
        'SyncQuickAccessUIState',
        QuickAccess.readDetail(wanted),
        { timeoutMs: QUICK_ACCESS_TIMEOUT_MS },
      );

      if (result && result.type === TYPE.ERROR) return { ok: false, error: 'command rejected by CSP' };
      const state = QuickAccess.parseState(result && result.detail);
      return { ok: true, on: state.on, disabled: state.disabled, names: wanted };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Click one CSP command by name (docs/PROTOCOL.md, "Quick Access"). It is a
   * click, not a set, and the host answers success even for an unknown name — the
   * caller must confirm by reading the state back.
   */
  async clickQuickAccess(name) {
    const command = typeof name === 'string' ? name.trim() : '';
    if (!command) return { ok: false, error: 'no command name' };
    if (!this.client || !this.client.alive) return { ok: false, error: 'not connected' };
    try {
      const result = await this.client.request(
        'DoQuickAccess',
        QuickAccess.clickDetail(command),
        { timeoutMs: QUICK_ACCESS_TIMEOUT_MS },
      );
      if (result && result.type === TYPE.ERROR) return { ok: false, error: 'command rejected by CSP' };
      return { ok: true, command };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  snapshot() {
    const s = this.session.get();
    return {
      status: this.status(),
      color: this.lastColor,
      settings: this.settings.get(),
      paired: Boolean(s.ips && s.port && s.password),
    };
  }

  /** Is the current client in its own retry cycle? Auto-connect must not scan under it. */
  retrying() {
    return Boolean(this.client && !this.client.closed && this.client.reconnecting);
  }

  _setState(state, detail = '') {
    this.state = state;
    this.detail = detail;
    this.emit('status', this.status());
  }

  async start() {
    const s = this.session.get();
    if (s.ips && s.port && s.password) {
      const ok = await this.connectSaved();
      if (ok) return true;
    }

    if (this.client && this.client.alive) return true;
    this._setState('idle', 'Open File > Connect to smartphone in Clip Studio Paint, then click Connect.');
    return false;
  }

  /** Scan the screen for the Companion Mode QR code and pair. */
  async pair({ intervalMs = SCAN_INTERVAL_MS, timeoutMs = SCAN_TIMEOUT_MS } = {}) {
    if (this.scanning) return;

    this.scanning = true;
    const token = ++this._scanToken;
    await this._teardown();
    if (!this.scanning || token !== this._scanToken) return;
    this._setState('scanning', 'Looking for the Companion Mode QR code on screen...');
    const deadline = Date.now() + timeoutMs;
    try {
      while (this.scanning && token === this._scanToken && Date.now() < deadline) {
        const text = await scanOnce(isShareUrl, this.decodeFrame || undefined);
        if (text) {

          if (token !== this._scanToken) return;
          this.scanning = false;
          await this.pairWithPayload(text);
          return;
        }
        await delay(intervalMs);
      }
      if (token === this._scanToken && !this.state.startsWith('connect')) {
        this._setState('idle', 'No QR code found. Open File > Connect to smartphone and keep it visible.');
      }
    } catch (err) {
      if (token === this._scanToken) this._setState('error', err.message);
    } finally {

      if (token === this._scanToken) this.scanning = false;
    }
  }

  cancelScan() {
    this.scanning = false;
    this._scanToken++;
    if (this.state === 'scanning') this._setState('idle', 'Scan cancelled.');
  }

  /** Pair using a QR share URL or bare hex payload. */
  async pairWithPayload(payload) {
    const cfg = decodeConfig(payload);
    await this._teardown();
    const client = new CompanionClient(cfg);
    this._attach(client);
    this.client = client;
    this._setState('connecting', `Connecting to ${cfg.ips[0]}:${cfg.port}...`);
    try {
      await client.connect();
      if (this.client !== client) return;
      this._setState('authenticating', 'Authenticating...');
      const res = await client.authenticate({ reconnect: false });
      if (this.client !== client) return;
      this.session.replace({
        url: payload,
        ips: cfg.ips,
        port: cfg.port,
        generation: cfg.generation,
        password: client.password,
      });
      this._setState('connected', `Connected (${res.serverSpecVersion || cfg.generation})`);

      await this.readColor().catch(() => {});
    } catch (err) {
      client.close();

      if (this.client === client) {
        this.client = null;
        this._setState('error', `Could not connect: ${err.message}`);
      }
      throw err;
    }
  }

  /** Reconnect to the host using the saved rotated password. */
  async connectSaved() {
    const s = this.session.get();
    if (!s.ips || !s.port || !s.password) return false;
    await this._teardown();
    const client = new CompanionClient({
      ips: s.ips,
      port: s.port,
      generation: s.generation,
      password: s.password,

      connectTimeoutMs: 2000,
    });
    this._attach(client);
    this.client = client;
    this._setState('connecting', `Reconnecting to ${s.ips[0]}:${s.port}...`);
    try {
      await client.connect();
      if (this.client !== client) return false;
      await client.authenticate({ reconnect: true });
    } catch (err) {
      client.close();
      if (this.client === client) {
        this.client = null;

        if (/PasswordMismatch|authentication rejected/i.test(String(err && err.message))) {
          this.session.clear();
          this._setState('scanning', 'Saved password was rejected; looking for a new QR code...');
          this.pair().catch(() => {});
        } else {
          this._setState('idle', 'Saved pairing is no longer valid. Connect to Clip Studio Paint again.');
        }
      }
      return false;
    }
    if (this.client !== client) return false;
    this._setState('connected', 'Connected (reconnected)');
    await this.readColor().catch(() => {});
    return true;
  }

  async disconnect({ forget = false } = {}) {
    this.cancelScan();
    await this._teardown();
    if (forget) this.session.clear();
    this._setState('idle', forget ? 'Pairing removed.' : 'Disconnected.');
  }

  async _teardown() {
    this._stopPolling();

    this._clearBurst();
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
      this._pendingWrite = null;
    }
    if (this.client) {
      const c = this.client;
      this.client = null;
      c.close();
    }
  }

  _attach(client) {

    const superseded = () => client !== this.client || client.closed;
    client.on('authenticated', (res) => {

      this._ensurePolling();
      if (this._pendingWrite) this._flushWrite();
      if (superseded()) return;
      this._reconnectFailures = 0;
      this._setState('connected', `Connected (${res.serverSpecVersion || ''})`);
    });
    client.on('disconnect', () => {
      if (superseded()) return;
      this._setState('reconnecting', 'Connection lost - reconnecting...');
    });
    client.on('reconnecting', (d) => { if (!superseded()) this._setState('reconnecting', `Reconnecting in ${Math.round(d / 100) / 10}s...`); });
    client.on('reconnect-failed', (err) => {
      if (superseded()) return;
      this._reconnectFailures += 1;

      if (this._reconnectFailures >= MAX_RECONNECT_FAILURES) {
        this._teardown();
        this._setState('idle', 'Lost the pairing - looking for a new QR code...');
        return;
      }

      this._setState('reconnecting', `Reconnect failed: ${err.message}`);
    });
    client.on('shutdown', () => { if (!superseded()) this._setState('idle', 'Clip Studio Paint is closing.'); });
    client.on('color', (color) => {
      if (!superseded()) {
        this._hostColorSeq += 1;
        this._emitIfChanged(color);
      }
    });
  }

  /**
   * The official phone app polls SyncColorCircleUIState about twice a second
   * while the colour tab is open; host pushes alone are not reliable. We do the
   * same so desktop-side colour changes reflect here.
   */
  _ensurePolling() {
    if (this._pollTimer) return;
    this._fastUntil = Date.now() + POLL_FAST_WINDOW_MS;

    this._syncActive = true;
    this._lastGateAt = 0;
    this._pollTimer = setInterval(() => this._pollTick(), POLL_TICK_MS);
    this._pollTimer.unref?.();
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _pollTick() {
    const now = Date.now();
    if (now - this._lastGateAt >= SYNC_GATE_TICK_MS) {
      this._lastGateAt = now;
      this._updateSyncGate(now);
    }

    if (!this._syncActive) return;
    const interval = now < this._fastUntil ? POLL_FAST_MS : POLL_SLOW_MS;
    if (now - this._lastPollAt < interval) return;
    this._lastPollAt = now;
    this._pollOnce();
  }

  /**
   * True while we should keep the host's idle timer reset: our UI is on screen,
   * CSP is actually the app in use, and the machine has seen input recently.
   * Otherwise the user has stopped working, and holding the timer reset would
   * keep CSP's worktime tracker counting forever.
   */
  _mayKeepHostAwake() {
    try {
      return Boolean(this._windowVisible())
        && Boolean(this._cspForeground())
        && Number(this._systemIdleSeconds()) < SYNC_IDLE_LIMIT_S;
    } catch {
      return true;
    }
  }

  /** Flip the client's heartbeat between active (reset) and passive (keep-alive). */
  _updateSyncGate(now) {
    const client = this.client;
    if (!client || !client.alive) return;
    const allowed = this._mayKeepHostAwake();
    if (allowed === this._syncActive) return;
    this._syncActive = allowed;
    client.setSyncActive?.(allowed);
    if (allowed) {

      this._fastUntil = now + POLL_FAST_WINDOW_MS;
      this._lastPollAt = 0;
    }
  }

  async _pollOnce() {
    if (this._pollBusy) return;
    const client = this.client;
    if (!client || !client.alive) return;
    this._pollBusy = true;
    try {
      const seq = this._hostColorSeq;
      const color = await client.readColor();

      if (seq !== this._hostColorSeq) {
        return;
      }
      this._emitIfChanged(color, { fromPoll: true });
    } catch {

    } finally {
      this._pollBusy = false;
    }
  }

  _emitIfChanged(color, { fromPoll = false } = {}) {
    if (!color) {
      return;
    }
    if (Date.now() < this._suppressUntil) {
      return;
    }

    const prev = this.lastColor || {};
    const active = color.active || prev.active || null;
    const activeSlot = active === 'main' ? (color.main || prev.main)
      : active === 'sub' ? (color.sub || prev.sub) : null;
    const suppliedActive = Boolean(active && color[active] && color[active].rgb);
    const activeChanged = Boolean(color.active && color.active !== prev.active);

    const freshRgb = color.rgb
      || (suppliedActive ? color[active].rgb : null)
      || (activeChanged && activeSlot ? activeSlot.rgb : null);
    if (fromPoll && freshRgb && this._lastChange
      && Date.now() - this._lastChange.at < POLL_LAG_GUARD_MS
      && sameRgb(freshRgb, this._lastChange.from)) {

      this._lagSeen += 1;
      if (this._lagSeen < 2) {
        return;
      }
      this._lagSeen = 0;
    } else if (fromPoll && this._lastChange) {
      this._lagSeen = 0;
    }
    const next = {
      ...prev,
      main: color.main || prev.main || null,
      sub: color.sub || prev.sub || null,
      model: color.model || prev.model,
      index: typeof color.index === 'number' ? color.index : prev.index,
      transparent: typeof color.transparent === 'boolean' ? color.transparent : prev.transparent,
      manipulating: typeof color.manipulating === 'boolean' ? color.manipulating : prev.manipulating,
      active,
      rgb: freshRgb || prev.rgb || null,
      rgbFresh: Boolean(freshRgb),
      hsv: color.hsv || prev.hsv || null,
      alphaPercent: color.alphaPercent ?? prev.alphaPercent ?? null,
      brushSize: color.brushSize ?? prev.brushSize ?? null,
    };
    if (!next.rgb && !next.transparent) {
      return;
    }

    if (this._written && Date.now() >= this._written.until) this._clearBurst();

    if (this._written) {
      if (next.rgb && sameRgb(next.rgb, this._written)) {
        this._clearBurst();
      } else if (next.rgb && this._inBurst(next.rgb)) {

        if (this._burstBase && sameRgb(next.rgb, this._burstBase)) {
          const w = this._written;
          if (this.client && this.client.alive) this.client.setColorRgb(w.r, w.g, w.b).catch(() => {});
        }
        return;
      } else {
        this._clearBurst();
      }
    }

    if (sameColor(prev, next)) {
      return;
    }
    this.lastColor = next;
    if (prev.rgb && next.rgb) {
      this._lastChange = { from: { ...prev.rgb }, at: Date.now() };
      this._lagSeen = 0;
    }
    this._fastUntil = Date.now() + POLL_FAST_WINDOW_MS;

    const prevActiveSlot = active === 'main' ? prev.main
      : active === 'sub' ? prev.sub : null;
    const activeSlotChanged = Boolean(activeSlot && activeSlot.rgb
      && (!prevActiveSlot || !prevActiveSlot.rgb || !sameRgb(activeSlot.rgb, prevActiveSlot.rgb)));
    const isPick = Boolean(next.rgbFresh && next.rgb && !next.transparent
      && (!activeChanged || activeSlotChanged));
    if (isPick) this.emit('pick', { r: next.rgb.r, g: next.rgb.g, b: next.rgb.b });
    this.emit('color', next);
  }

  /** End the current write burst (our value landed, was superseded, or expired). */
  _clearBurst() {
    this._written = null;
    this._burstBase = null;
    this._recentWrites = [];
  }

  /** Does this value belong to our current write burst (an echo or lag of our own)? */
  _inBurst(rgb) {
    if (this._burstBase && sameRgb(rgb, this._burstBase)) return true;
    return this._recentWrites.some((w) => sameRgb(rgb, w));
  }

  /**
   * Select one of CSP's three colours. Writing a slot's own colour back with its
   * ColorIndex makes CSP activate that slot; the transparent variant selects the
   * eraser colour.
   */
  async selectSlot(slot) {
    const client = this.client;
    if (!client || !client.alive) return false;
    const cur = this.lastColor || {};

    if (slot === 'transparent') {
      client.setTransparent().catch(() => {  });
      this.lastColor = { ...cur, transparent: true, active: 'transparent' };
    } else if (slot === 'sub' || slot === 'main') {
      const chosen = slot === 'sub' ? cur.sub : cur.main;
      if (!chosen || !chosen.rgb) return false;

      const hsv = chosen.hsv || Color.rgbToHsv(chosen.rgb.r / 255, chosen.rgb.g / 255, chosen.rgb.b / 255);
      client.setSlotColor(slot === 'sub' ? 1 : 0, hsv).catch(() => {  });
      this.lastColor = {
        ...cur,
        transparent: false,
        active: slot,
        rgb: chosen.rgb,
        rgbFresh: true,
        hsv,
        index: slot === 'sub' ? 1 : 0,
      };
    } else {
      return false;
    }

    this._suppressUntil = Date.now() + SUPPRESS_PUSH_MS;
    this._fastUntil = Date.now() + POLL_FAST_WINDOW_MS;
    this.emit('color', this.lastColor);
    return true;
  }

  async readColor() {
    if (!this.client || !this.client.alive) return null;
    const color = await this.client.readColor();

    if (color) this._emitIfChanged(color);
    return color;
  }

  /**
   * Broadcast a display-only live preview from one palette to its siblings.
   * Deliberately does not touch lastColor, history or the CSP write queue.
   */
  previewColor(lab, { sourceId = 0, active = null } = {}) {
    if (!lab || ![lab.L, lab.a, lab.b].every(Number.isFinite)) return;
    this._preview = { lab: { L: lab.L, a: lab.a, b: lab.b }, sourceId, active };
    if (this._previewTimer) return;
    this._previewTimer = setTimeout(() => {
      this._previewTimer = null;
      const p = this._preview;
      this._preview = null;
      if (p) this.emit('preview', p);
    }, 16);
  }

  /**
   * Push a color to CSP. Updates are coalesced so dragging the picker emits at
   * most one SetCurrentColor per WRITE_INTERVAL_MS; pass immediate for the final
   * value on pointer-up.
   */
  writeColor(rgb, { immediate = false } = {}) {
    if (immediate) {
      if (this._previewTimer) clearTimeout(this._previewTimer);
      this._previewTimer = null;
      this._preview = null;
    }
    this._pendingWrite = { r: rgb.r | 0, g: rgb.g | 0, b: rgb.b | 0 };
    this._suppressUntil = Date.now() + SUPPRESS_PUSH_MS;

    if (!this.client || !this.client.alive) return;
    if (immediate) {
      this._flushWrite();
      return;
    }
    if (this._writeTimer) return;
    this._writeTimer = setTimeout(() => this._flushWrite(), WRITE_INTERVAL_MS);
  }

  _flushWrite() {
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
    }
    const rgb = this._pendingWrite;
    this._pendingWrite = null;
    if (!rgb) return;
    if (!this.client || !this.client.alive) {

      if (!this._pendingWrite) this._pendingWrite = rgb;
      return;
    }

    const prev = this.lastColor || {};
    const active = prev.active && prev.active !== 'transparent' ? prev.active : 'main';
    const hs = Color.rgbToHsv(rgb.r / 255, rgb.g / 255, rgb.b / 255);
    const slot = { rgb: { r: rgb.r, g: rgb.g, b: rgb.b }, hsv: { h: hs.h, s: hs.s, v: hs.v } };
    this.lastColor = {
      ...prev,
      rgb: slot.rgb,
      transparent: false,
      active,
      main: active === 'sub' ? prev.main || null : slot,
      sub: active === 'sub' ? slot : prev.sub || null,
      model: prev.model || 'HSV',
      raw: null,
    };
    this.client.setColorRgb(rgb.r, rgb.g, rgb.b).catch(() => {  });
    this._fastUntil = Date.now() + POLL_FAST_WINDOW_MS;

    if (!this._written) {
      this._burstBase = prev.rgb ? { ...prev.rgb } : null;
      this._recentWrites = [];
    }
    this._recentWrites.push({ r: rgb.r, g: rgb.g, b: rgb.b });
    if (this._recentWrites.length > 8) this._recentWrites.shift();
    this._written = { r: rgb.r, g: rgb.g, b: rgb.b, until: Date.now() + WRITE_GRACE_MS };

    this.emit('color', this.lastColor);
  }
}

module.exports = { CompanionService, sameColor };

/** True when two colour states are effectively identical (1/255 tolerance). */
function sameColor(a, b) {
  if (!a || !b) return a === b;
  if (a.active !== b.active) return false;
  if (Boolean(a.transparent) !== Boolean(b.transparent)) return false;
  if (!sameRgb(a.rgb, b.rgb)) return false;
  if (!sameRgb(a.main && a.main.rgb, b.main && b.main.rgb)) return false;
  if (!sameRgb(a.sub && a.sub.rgb, b.sub && b.sub.rgb)) return false;
  return true;
}

function sameRgb(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs(a.r - b.r) <= 1 && Math.abs(a.g - b.g) <= 1 && Math.abs(a.b - b.b) <= 1;
}

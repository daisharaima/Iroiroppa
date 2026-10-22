'use strict';

// Companion Mode TCP client — the "phone side" of CSP's remote-control protocol.
//
// Lifecycle:
//   connect()            dial the host, start the receive loop
//   authenticate()       Authenticate with the QR password, rotate in a new one
//   ...                  request() / setColorRgb() / readColor()
//   startKeepalive()     TellHeartbeat every second (idle-timer reset when active)
//   setSyncActive(bool)  toggle whether that heartbeat keeps the host awake
//
// The host starves Sync* reads unless a heartbeat requests an idle-timer reset,
// so while we need live state the heartbeat carries `IdleTimerResetRequested`.
// That flag resets the same idle timer CSP uses to pause a document's worktime
// tracker, so it must NOT be sent unconditionally: when nobody is working the
// service turns it off and the connection survives on passive heartbeats.

const net = require('node:net');
const { EventEmitter } = require('node:events');
const { encodeFrame, splitFrames, parseFrame, TYPE } = require('./packets');
const { authHex, makePassword } = require('./crypto');
const { COMMANDS, AUTH_FAILURES, COLOR_SPACE, MAX_U32 } = require('./commands');
const Color = require('../../shared/color');

const RECONNECT_MARKER = '{{(([[reconnection request marker]]))}}\r\n';
const HEARTBEAT_MS = 1000;
const DEFAULT_TIMEOUT_MS = 8000;
// A dropped socket should come back as soon as CSP does. The old 500 → ×2 → 15 s
// ladder could leave a 15 s hole after a few failures, which read as "not instant".
const RECONNECT_FIRST_MS = 250;
const RECONNECT_FACTOR = 1.6;
const MAX_RECONNECT_DELAY_MS = 5000;
// A saved pairing's port is stale as soon as CSP's QR window is reopened, so
// dialling a dead address must fail fast instead of waiting for the OS's ~20 s
// connect timeout: for a candidate list that can stall startup for a minute.
const CONNECT_TIMEOUT_MS = 4000;

class CompanionError extends Error {}

class CompanionClient extends EventEmitter {
  /**
   * @param {object} cfg
   * @param {string[]} cfg.ips        candidate host addresses from the QR
   * @param {number}   cfg.port       host TCP port
   * @param {string}   cfg.generation spec version tag (e.g. "G#1:2022.12")
   * @param {string}   cfg.password   session password (QR password first, then rotated)
   */
  constructor(cfg) {
    super();
    this.ips = cfg.ips.slice();
    this.port = cfg.port;
    this.generation = cfg.generation;
    this.password = cfg.password;

    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.serial = 0;
    this.pending = new Map();
    this.alive = false;
    this.closed = false;
    this.reconnecting = false;
    this.keepaliveTimer = null;
    // Whether our heartbeat should request an idle-timer reset. Default true so
    // a bare client (the probe, tests) behaves exactly as before; the service
    // lowers it when the user stops working so CSP's worktime tracker can pause.
    this.syncActive = true;
    this.reconnectDelay = RECONNECT_FIRST_MS;
    // A saved pairing may be dialling a port CSP has already rotated away from; the
    // service gives it a shorter deadline than a fresh QR pair.
    this.connectTimeoutMs = Number.isFinite(cfg.connectTimeoutMs) ? cfg.connectTimeoutMs : CONNECT_TIMEOUT_MS;
    this.remoteAddress = null;
    this.serverSpecVersion = null;
    this.quickAccessAvailable = null;
    this._connectAbort = null;
  }

  // --- connection ----------------------------------------------------------

  /** Dial the host (trying each candidate IP). Resolves once TCP is connected. */
  connect() {
    return new Promise((resolve, reject) => {
      let idx = 0;
      const errors = [];
      let settled = false;
      const attempt = { sock: null, timer: null };
      const finish = (err) => {
        if (settled) return;
        settled = true;
        if (attempt.timer) { clearTimeout(attempt.timer); attempt.timer = null; }
        this._connectAbort = null;
        if (err) reject(err);
        else resolve();
      };
      const tryNext = () => {
        if (settled) return;
        if (idx >= this.ips.length) {
          finish(new CompanionError(`could not reach CSP at ${this.ips.join(', ')}:${this.port} (${errors.join('; ')})`));
          return;
        }
        const ip = this.ips[idx++];
        const sock = net.createConnection({ host: ip, port: this.port });
        attempt.sock = sock;
        sock.setNoDelay(true);
        let used = false;
        const advance = (msg) => {
          if (used || settled) return;
          used = true;
          if (attempt.timer) { clearTimeout(attempt.timer); attempt.timer = null; }
          if (msg) errors.push(msg);
          sock.destroy();
          tryNext();
        };
        attempt.timer = setTimeout(() => advance(`${ip}: timed out`), this.connectTimeoutMs);
        attempt.timer.unref?.();
        sock.once('connect', () => {
          if (used || settled) return;
          used = true;
          if (attempt.timer) { clearTimeout(attempt.timer); attempt.timer = null; }
          sock.removeAllListeners('error');
          this._attach(sock);
          finish();
        });
        sock.once('error', (err) => advance(`${ip}: ${err.code || err.message}`));
      };
      // close() uses this to settle a dial that is still in flight, so callers
      // never await a promise that a teardown can no longer resolve.
      this._connectAbort = () => {
        attempt.sock?.destroy();
        finish(new CompanionError('connection closed'));
      };
      tryNext();
    });
  }

  _attach(sock) {
    // A reconnect can attach while an older socket is still open (a failed auth
    // leaves it alive): that socket's later close would otherwise destroy this one.
    if (this.socket && this.socket !== sock) {
      const old = this.socket;
      this.socket = null;
      old.removeAllListeners();
      old.destroy();
    }
    this.socket = sock;
    this.buffer = Buffer.alloc(0);
    this.remoteAddress = `${sock.remoteAddress}:${sock.remotePort}`;
    sock.on('data', (chunk) => this._onData(chunk));
    sock.on('error', (err) => this._onSocketEnd(err));
    sock.on('close', () => this._onSocketEnd(new Error('connection closed')));
    this.emit('connecting', this.remoteAddress);
  }

  _onSocketEnd(err) {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    const wasAlive = this.alive;
    this.alive = false;
    this._rejectAll(new CompanionError(err ? err.message : 'disconnected'));
    if (this.closed) return;
    this.emit('disconnect', err);
    if (wasAlive || this.password) this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(Math.round(this.reconnectDelay * RECONNECT_FACTOR), MAX_RECONNECT_DELAY_MS);
    this.emit('reconnecting', delay);
    const timer = setTimeout(async () => {
      try {
        await this.connect();
        await this.authenticate({ reconnect: true });
        this.reconnectDelay = RECONNECT_FIRST_MS;
      } catch (err) {
        this.emit('reconnect-failed', err);
        this.reconnecting = false;
        this._scheduleReconnect();
        return;
      }
      this.reconnecting = false;
    }, delay);
    timer.unref?.();
  }

  // --- framing / dispatch --------------------------------------------------

  _onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const { frames, rest } = splitFrames(this.buffer);
    this.buffer = Buffer.from(rest);
    for (const frame of frames) {
      const pkt = parseFrame(frame);
      if (pkt) this._dispatch(pkt);
    }
  }

  _dispatch(pkt) {
    if (pkt.type === TYPE.CLIENT) {
      this._handleIncoming(pkt);
      return;
    }
    const entry = this.pending.get(pkt.serial);
    if (!entry) return;
    this.pending.delete(pkt.serial);
    clearTimeout(entry.timer);
    entry.resolve(pkt);
  }

  /** Reply to a host-initiated command and surface it to listeners. */
  _handleIncoming(pkt) {
    try {
      this._write(TYPE.SUCCESS, pkt.command, pkt.serial, null);
    } catch {
      /* best effort ACK */
    }
    if (pkt.command === COMMANDS.PreNotifyOfServerShutdown) {
      this.emit('shutdown', pkt.detail);
    }
    if (pkt.command === COMMANDS.SyncColorCircleUIState && pkt.detail) {
      const color = parseColorState(pkt.detail);
      if (color) this.emit('color', color);
    }
    this.emit('command', pkt);
  }

  _write(type, command, serial, detail) {
    if (!this.socket || this.socket.destroyed) throw new CompanionError('not connected');
    this.socket.write(encodeFrame(type, command, serial, detail));
  }

  // --- commands ------------------------------------------------------------

  /**
   * Send a command and wait for its response packet.
   * @param {string} command
   * @param {any} detail JSON-serializable detail, a pre-encoded string/Buffer, or null
   * @param {{timeoutMs?:number}} [opts]
   */
  request(command, detail, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      let payload = null;
      if (detail != null) {
        payload = Buffer.isBuffer(detail) || typeof detail === 'string'
          ? Buffer.from(detail)
          : Buffer.from(JSON.stringify(detail), 'utf8');
      }
      const serial = this.serial++;
      const timer = setTimeout(() => {
        this.pending.delete(serial);
        reject(new CompanionError(`timed out waiting for ${command}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(serial, { resolve, reject, timer });
      try {
        this._write(TYPE.CLIENT, command, serial, payload);
      } catch (err) {
        this.pending.delete(serial);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /** Fire-and-forget command (no response waiter). */
  send(command, detail) {
    const payload = detail == null
      ? null
      : Buffer.isBuffer(detail) || typeof detail === 'string'
        ? Buffer.from(detail)
        : Buffer.from(JSON.stringify(detail), 'utf8');
    this._write(TYPE.CLIENT, command, this.serial++, payload);
  }

  _rejectAll(err) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  // --- auth ----------------------------------------------------------------

  /**
   * Authenticate. On first auth, send [generation, enc(qrPassword), enc(newPassword)]
   * and remember `newPassword`. On reconnect, send the reconnection marker plus
   * that same saved password (the host requires the identical value).
   */
  async authenticate({ reconnect = false } = {}) {
    const currentToken = reconnect ? RECONNECT_MARKER : this.password;
    const newPassword = reconnect ? this.password : makePassword();

    const detail = [this.generation, authHex(currentToken), authHex(newPassword)];
    // A reconnect is not the place to wait 8 s for a host that is not answering; the
    // service falls back to a scan soon after.
    const pkt = await this.request(COMMANDS.Authenticate, detail, { timeoutMs: reconnect ? 4000 : 8000 });

    const res = parseAuthResult(pkt);
    if (!res.ok) {
      throw new CompanionError(`authentication rejected: ${res.reason || 'unknown reason'}`);
    }

    this.serverSpecVersion = res.serverSpecVersion || this.serverSpecVersion;
    this.quickAccessAvailable = res.quickAccessAvailable;
    if (!reconnect) this.password = newPassword;
    this.alive = true;
    // A successful auth is the proof the next retry (if one is ever needed) should be
    // fast again; the exponential backoff is only for a host that stays away.
    this.reconnectDelay = RECONNECT_FIRST_MS;
    this.emit('authenticated', res);
    this.startKeepalive();
    return res;
  }

  startKeepalive() {
    if (this.keepaliveTimer) return;
    this.keepaliveTimer = setInterval(() => this._sendHeartbeat(), HEARTBEAT_MS);
    this.keepaliveTimer.unref?.();
    // Beat once right away so the first poll after authenticating is not starved
    // by the idle gate (which we may not have cleared on this fresh socket yet).
    if (this.syncActive) this._sendHeartbeat();
  }

  /** One TellHeartbeat, carrying the idle-timer reset only while sync is active. */
  _sendHeartbeat() {
    if (!this.alive || !this.socket) return;
    const detail = this.syncActive ? { IdleTimerResetRequested: true } : null;
    this.request(COMMANDS.TellHeartbeat, detail, { timeoutMs: 4000 })
      .catch(() => { /* the socket close handler drives reconnects */ });
  }

  /**
   * Toggle whether the heartbeat keeps the host's idle timer reset. `true` gives
   * us live Sync* state but also stops CSP pausing the document worktime tracker,
   * so the service lowers it whenever the user stops working. The TCP connection
   * is unaffected either way — a passive (empty) heartbeat is still a keep-alive.
   */
  setSyncActive(on) {
    const next = Boolean(on);
    if (next === this.syncActive) return;
    this.syncActive = next;
    // Becoming active: clear the gate at once so the next poll returns state
    // instead of starving. Becoming passive just waits for the next tick.
    if (next) this._sendHeartbeat();
  }

  // --- color ---------------------------------------------------------------

  /** Read the current (active) drawing color as RGB + metadata. */
  async readColor() {
    // A deliberately stale request forces the host to return a full color payload
    // instead of a partial diff.
    const stale = {
      IsManipulating: false,
      HSVColorMainH: 0,
      HSVColorMainS: 0,
      HSVColorMainV: 0,
      CurrentColorIndex: 0,
      ColorSelectionModel: COLOR_SPACE.HSV,
    };
    const pkt = await this.request(COMMANDS.SyncColorCircleUIState, stale);
    return parseColorState(pkt.detail);
  }

  /** Set the current drawing color from RGB (0-255). */
  async setColorRgb(r, g, b, transparent = false) {
    await this.request(COMMANDS.SetCurrentColor, {
      IsColorTransparent: !!transparent,
      RGBColorR: clampByte(r),
      RGBColorG: clampByte(g),
      RGBColorB: clampByte(b),
    });
  }

  /**
   * Write a colour into a specific slot (0 = main/foreground, 1 = sub/background)
   * using the HSV variant. Verified against CSP 5.0.4: this also makes that slot
   * the active colour, so it doubles as "select slot".
   */
  async setSlotColor(index, hsv) {
    const h = Math.round((Color.mod360(hsv.h) / 360) * MAX_U32);
    const s = Math.round(clamp01(hsv.s) * MAX_U32);
    const v = Math.round(clamp01(hsv.v) * MAX_U32);
    await this.request(COMMANDS.SetCurrentColor, {
      ColorIndex: index === 1 ? 1 : 0,
      IsColorTransparent: false,
      ColorSpaceKind: COLOR_SPACE.HSV,
      HSVColorH: h,
      HSVColorS: s,
      HSVColorV: v,
    });
  }

  /** Select CSP's transparent (eraser) colour. */
  async setTransparent() {
    await this.request(COMMANDS.SetCurrentColor, {
      IsColorTransparent: true,
      RGBColorR: 0,
      RGBColorG: 0,
      RGBColorB: 0,
    });
  }

  close() {
    this.closed = true;
    this.alive = false;
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    // Settle a dial that is still in flight, or its caller would await forever.
    const abortConnect = this._connectAbort;
    this._connectAbort = null;
    if (abortConnect) abortConnect();
    this._rejectAll(new CompanionError('client closed'));
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      s.removeAllListeners();
      s.destroy();
    }
    this.emit('closed');
  }
}

// --- helpers ---------------------------------------------------------------

function clampByte(x) {
  const n = Math.round(Number(x) || 0);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

function clamp01(x) {
  const n = Number(x) || 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function parseAuthResult(pkt) {
  const d = pkt.detail;
  const out = { ok: true, reason: '', serverSpecVersion: '', quickAccessAvailable: null };
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    out.reason = d.AuthErrorReason || '';
    out.serverSpecVersion = d.RemoteCommandSpecVersionOfServer || '';
    if (typeof d.IsQuickAccessAvailable === 'boolean') out.quickAccessAvailable = d.IsQuickAccessAvailable;
    out.ok = !AUTH_FAILURES.has(out.reason);
  } else if (Array.isArray(d)) {
    out.ok = true; // bare [true,false] success array
  }
  // A bodyless error packet is a genuine failure.
  if ((pkt.rawDetail == null || pkt.rawDetail.length === 0) && pkt.type === TYPE.ERROR) out.ok = false;
  return out;
}

/**
 * Decode a SyncColorCircleUIState / SyncColorMix / SyncSubView detail into a
 * color result. Returns null when the payload has no usable color.
 *
 * CSP has two solid colour slots (main/foreground and sub/background) plus the
 * transparent colour, so we surface all three and which one is active.
 */
function parseColorState(d) {
  if (!d || typeof d !== 'object') return null;

  // Color-mix / sub-view variants carry a single plain RGB value.
  if (typeof d.CurrentColorRed === 'number' && typeof d.CurrentColorGreen === 'number') {
    const rgb = {
      r: Color.clamp(Math.round(d.CurrentColorRed), 0, 255),
      g: Color.clamp(Math.round(d.CurrentColorGreen), 0, 255),
      b: Color.clamp(Math.round(d.CurrentColorBlue), 0, 255),
    };
    const slot = { rgb, hsv: Color.rgbToHsv(rgb.r / 255, rgb.g / 255, rgb.b / 255) };
    return {
      main: slot,
      sub: null,
      active: 'main',
      rgb,
      hsv: slot.hsv,
      index: 0,
      model: COLOR_SPACE.HSV,
      transparent: !!d.IsCurrentColorTransparent,
      manipulating: !!d.IsManipulating,
      alphaPercent: typeof d.CurrentToolAlphaPercent === 'number' ? d.CurrentToolAlphaPercent : null,
      brushSize: typeof d.CurrentToolBrushSize === 'number' ? d.CurrentToolBrushSize : null,
      raw: d,
    };
  }

  const index = typeof d.CurrentColorIndex === 'number' ? d.CurrentColorIndex : 0;
  const model = d.ColorSelectionModel || COLOR_SPACE.HSV;
  const main = decodeSlot(d, 'Main', model);
  const sub = decodeSlot(d, 'Sub', model);
  const transparent = !!d.IsCurrentColorTransparent;
  if (!main && !sub && !transparent) return null;

  // A payload is only authoritative for the active colour when it actually
  // carries that slot's channels; otherwise it is a partial diff.
  const activeSlot = index === 1 ? sub : main;
  const full = transparent || Boolean(activeSlot);
  const chosen = activeSlot || main || sub;

  return {
    main,
    sub,
    active: full ? (transparent ? 'transparent' : index === 1 ? 'sub' : 'main') : null,
    rgb: full && chosen ? chosen.rgb : null,
    hsv: full && chosen ? chosen.hsv : null,
    index,
    model,
    transparent,
    partial: !full,
    manipulating: !!d.IsManipulating,
    alphaPercent: typeof d.CurrentToolAlphaPercent === 'number' ? d.CurrentToolAlphaPercent : null,
    brushSize: typeof d.CurrentToolBrushSize === 'number' ? d.CurrentToolBrushSize : null,
    raw: d,
  };
}

/** Decode one solid slot (Main/Sub) into { rgb, hsv }, or null when absent. */
function decodeSlot(d, prefix, model) {
  if (model === COLOR_SPACE.HLS && typeof d[`HLSColor${prefix}H`] === 'number') {
    const h = Color.u32ToHue(d[`HLSColor${prefix}H`]);
    const l = Color.u32ToUnit(d[`HLSColor${prefix}L`]);
    const s = Color.u32ToUnit(d[`HLSColor${prefix}S`]);
    const rgb = hlsToRgb255(h, l, s);
    return { rgb, hsv: Color.rgbToHsv(rgb.r / 255, rgb.g / 255, rgb.b / 255) };
  }
  if (typeof d[`HSVColor${prefix}H`] === 'number') {
    const h = Color.u32ToHue(d[`HSVColor${prefix}H`]);
    const s = Color.u32ToUnit(d[`HSVColor${prefix}S`]);
    const v = Color.u32ToUnit(d[`HSVColor${prefix}V`]);
    const f = Color.hsvToRgb(h, s, v);
    const rgb = { r: clampByte(f.r * 255), g: clampByte(f.g * 255), b: clampByte(f.b * 255) };
    return { rgb, hsv: { h, s, v } };
  }
  return null;
}

function hlsToRgb255(h, l, s) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = Color.mod360(h) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: clampByte((r + m) * 255), g: clampByte((g + m) * 255), b: clampByte((b + m) * 255) };
}

module.exports = { CompanionClient, CompanionError, parseColorState, parseAuthResult, RECONNECT_MARKER };

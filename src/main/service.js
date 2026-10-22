'use strict';

// CompanionService owns the connection lifecycle and exposes a small, stable
// surface to the Electron main process and renderer:
//
//   start()                 try the saved pairing, else idle
//   pair()                  scan the screen for the QR and connect
//   pairWithPayload(p)      connect using a QR URL/hex you provide
//   readColor()             pull the current brush color
//   writeColor(rgb)         push a color (coalesced to ~1 update / 60 ms)
//   disconnect({forget})    drop the socket (and optionally the pairing)
//
// Emits: 'status' and 'color'.

const { EventEmitter } = require('node:events');
const { CompanionClient } = require('./companion/client');
const { decodeConfig, isShareUrl } = require('./companion/qr');
const { scanOnce } = require('./capture');
const { TYPE } = require('./companion/packets');
const Color = require('../shared/color');

const SCAN_TIMEOUT_MS = 90000;
const SCAN_INTERVAL_MS = 600;
const WRITE_INTERVAL_MS = 60;
const SUPPRESS_PUSH_MS = 500;
// Adaptive polling: fast right after any change (so dragging CSP's eyedropper
// feels live), slow when nothing is happening.
const POLL_TICK_MS = 50;
const POLL_FAST_MS = 100;
const POLL_SLOW_MS = 300;
const POLL_FAST_WINDOW_MS = 1500;
// CSP can answer a poll with the colour from before a just-visible change
// (its host read-back lags). Within this window, a poll that reverts to the
// colour we just changed *from* is stale, not a real pick.
const POLL_LAG_GUARD_MS = 5000;
const WRITE_GRACE_MS = 1500;
// The Companion heartbeat's idle-timer reset is what keeps our Sync* reads
// flowing — but it resets the very timer CSP uses to pause a document's
// worktime tracker, so sending it forever makes that tracker useless. We only
// keep the host awake while the palette is on screen and the machine has seen
// recent input; otherwise a passive heartbeat keeps the connection alive and
// CSP is free to stop counting. The limit is well under CSP's own pause (~1–2
// min), and the gate is checked often enough to wake within a poll or two.
const SYNC_IDLE_LIMIT_S = 12;
const SYNC_GATE_TICK_MS = 500;
// A saved pairing whose password CSP has rotated can never re-authenticate, so
// after this many failed reconnects the service gives up and goes idle — which
// re-arms auto-connect, so it scans for the new QR instead of retrying forever.
const MAX_RECONNECT_FAILURES = 4;

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
    // Optional off-main QR decoder (docs/STATE.md, §6); null = decode here.
    this.decodeFrame = decodeFrame;
    this.client = null;
    this.state = 'idle';
    this.detail = '';
    this.lastColor = null;
    this.scanning = false;
    this._scanToken = 0;
    this._writeTimer = null;
    this._pendingWrite = null;
    this._suppressUntil = 0;
    this._pollTimer = null;
    this._pollBusy = false;
    // A host push is newer than a poll that was already in flight. The sequence
    // lets _pollOnce drop a stale response instead of overwriting the push.
    this._hostColorSeq = 0;
    this._lastChange = null; // { from, at } for the poll lag guard
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

  // --- introspection -------------------------------------------------------

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
      // A NAK resolves like an ACK (client._dispatch resolves any reply), so without
      // this check the key-send fallback in csp:invoke never ran.
      if (result && result.type === TYPE.ERROR) return { ok: false, error: 'command rejected by CSP' };
      return { ok: true, result };
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

  // --- lifecycle -----------------------------------------------------------

  async start() {
    const s = this.session.get();
    if (s.ips && s.port && s.password) {
      const ok = await this.connectSaved();
      if (ok) return true;
    }
    // A superseded reconnect (e.g. a manual pair won while it dialled) must not
    // reset the live connection back to idle.
    if (this.client && this.client.alive) return true;
    this._setState('idle', 'Open File > Connect to smartphone in Clip Studio Paint, then click Connect.');
    return false;
  }

  /** Scan the screen for the Companion Mode QR code and pair. */
  async pair({ intervalMs = SCAN_INTERVAL_MS, timeoutMs = SCAN_TIMEOUT_MS } = {}) {
    if (this.scanning) return;
    // Claim the scan before awaiting teardown: two callers used to both pass the
    // guard and run scan loops that tore each other's clients down.
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
          // A cancel or a newer pair may have landed while the capture was in flight.
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
      // Only the scan that still owns the token may clear the flag: a superseded
      // scan's exit used to cancel a newer scan that had already claimed it.
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
      // A first read is a convenience, not part of connecting: a slow or empty
      // read must never tear down a connection that just authenticated.
      await this.readColor().catch(() => {});
    } catch (err) {
      client.close();
      // Only the attempt that still owns `client` may report the failure and
      // clear it; a newer manual/auto attempt has already taken over otherwise.
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
      // A saved port goes stale when CSP's QR window is reopened; fail over to the
      // scan sooner instead of waiting out the OS's connect timeout.
      connectTimeoutMs: 2000,
    });
    this._attach(client);
    this.client = client;
    this._setState('connecting', `Reconnecting to ${s.ips[0]}:${s.port}...`);
    try {
      await client.connect();
      if (this.client !== client) return false;
      await client.authenticate({ reconnect: true });
    } catch {
      client.close();
      if (this.client === client) {
        this.client = null;
        this._setState('idle', 'Saved pairing is no longer valid. Connect to Clip Studio Paint again.');
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
    // The grace window is meaningless once the socket is gone.
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
    // A superseded attempt can still emit late events; none of them may touch
    // the newer connection's status or colour.
    const superseded = () => client !== this.client || client.closed;
    client.on('authenticated', (res) => {
      // Polling is harmless to start for any authenticating client, but the
      // state may only be reported by whoever still owns the connection.
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
      // A rotated password can never re-authenticate. Give up and go idle so
      // auto-connect scans for the new QR instead of retrying forever.
      if (this._reconnectFailures >= MAX_RECONNECT_FAILURES) {
        this._teardown();
        this._setState('idle', 'Lost the pairing - looking for a new QR code...');
        return;
      }
      // Stay in `reconnecting`: auto-connect treats `error` as "start a scan", which
      // would tear down the client's own quick retry and turn a 250 ms retry into a
      // 30 s scan. The status still tells the user what is happening.
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

  // --- passive colour polling ---------------------------------------------

  /**
   * The official phone app polls SyncColorCircleUIState about twice a second
   * while the colour tab is open; host pushes alone are not reliable. We do the
   * same so desktop-side colour changes reflect here.
   */
  _ensurePolling() {
    if (this._pollTimer) return;
    this._fastUntil = Date.now() + POLL_FAST_WINDOW_MS;
    // A fresh client starts awake; the gate lowers it on the first idle tick.
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
    // Passive: stop sending Sync* entirely, so nothing we do could be read as
    // activity while CSP is deciding whether to pause the worktime tracker.
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
      return true; // no idle source (e.g. a test): behave as before
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
      // Work resumed: read fresh state at once so the palette is live again.
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
      // A host push arrived while this read was in flight; the read is older
      // than the push and must not overwrite it.
      if (seq !== this._hostColorSeq) {
        return;
      }
      this._emitIfChanged(color, { fromPoll: true });
    } catch {
      /* transient; the socket handlers drive reconnects */
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

    // Merge into the last known state so a partial payload (which omits some
    // fields) cannot blank a slot or fabricate a colour change.
    const prev = this.lastColor || {};
    const active = color.active || prev.active || null;
    const activeSlot = active === 'main' ? (color.main || prev.main)
      : active === 'sub' ? (color.sub || prev.sub) : null;
    const suppliedActive = Boolean(active && color[active] && color[active].rgb);
    const activeChanged = Boolean(color.active && color.active !== prev.active);
    // `color.rgb` is the authoritative active colour on a full payload. On a
    // partial payload it is absent, and merely merging prev.rgb would keep the
    // *previous* pick. Derive it from the active slot instead; if the update
    // only touched the inactive slot, it is not a history pick (`rgbFresh:false`).
    const freshRgb = color.rgb
      || (suppliedActive ? color[active].rgb : null)
      || (activeChanged && activeSlot ? activeSlot.rgb : null);
    if (fromPoll && freshRgb && this._lastChange
      && Date.now() - this._lastChange.at < POLL_LAG_GUARD_MS
      && sameRgb(freshRgb, this._lastChange.from)) {
      // Host read-back lag: this poll shows the colour we just changed away
      // from. Require two consecutive polls before believing a revert.
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

    // A write we just issued must win against the host's lagging read-back, but a
    // genuine change on the host side (an eyedropper in CSP) must still come
    // through. So we suppress anything that belongs to our own write burst — our
    // latest value, an earlier value we wrote, or the value we replaced — and
    // accept anything else. Never suppress by time alone (docs/INVARIANTS.md).
    if (this._written && Date.now() >= this._written.until) this._clearBurst();

    if (this._written) {
      if (next.rgb && sameRgb(next.rgb, this._written)) {
        this._clearBurst(); // our value landed
      } else if (next.rgb && this._inBurst(next.rgb)) {
        // Our own lagging echo: never show it. If the host is still on the value we
        // replaced it has not accepted any write yet — nudge it; otherwise it is an
        // earlier write of ours and will catch up on its own.
        if (this._burstBase && sameRgb(next.rgb, this._burstBase)) {
          const w = this._written;
          if (this.client && this.client.alive) this.client.setColorRgb(w.r, w.g, w.b).catch(() => {});
        }
        return;
      } else {
        this._clearBurst(); // a real change (e.g. an eyedropper in CSP)
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
    // A host *pick* is decided here, not by a renderer: an inactive-slot-only
    // partial has no fresh rgb, and a pure foreground/background switch is not a
    // new colour. `selectSlot`/`_flushWrite` emit 'color' directly and never
    // reach this point, so our own switches and writes cannot record history.
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
      client.setTransparent().catch(() => { /* surfaced via status */ });
      this.lastColor = { ...cur, transparent: true, active: 'transparent' };
    } else if (slot === 'sub' || slot === 'main') {
      const chosen = slot === 'sub' ? cur.sub : cur.main;
      if (!chosen || !chosen.rgb) return false;
      // The cached slot may carry only RGB (e.g. right after a write), so derive
      // HSV when it is missing instead of refusing to switch.
      const hsv = chosen.hsv || Color.rgbToHsv(chosen.rgb.r / 255, chosen.rgb.g / 255, chosen.rgb.b / 255);
      client.setSlotColor(slot === 'sub' ? 1 : 0, hsv).catch(() => { /* surfaced via status */ });
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
    this.emit('color', this.lastColor); // reflect the switch immediately
    return true;
  }

  // --- color ---------------------------------------------------------------

  async readColor() {
    if (!this.client || !this.client.alive) return null;
    const color = await this.client.readColor();
    // Merge through the polling path so a partial payload cannot blank a slot
    // and the write grace window still applies.
    if (color) this._emitIfChanged(color);
    return color;
  }

  /**
   * Push a color to CSP. Updates are coalesced so dragging the picker emits at
   * most one SetCurrentColor per WRITE_INTERVAL_MS; pass immediate for the final
   * value on pointer-up.
   */
  writeColor(rgb, { immediate = false } = {}) {
    this._pendingWrite = { r: rgb.r | 0, g: rgb.g | 0, b: rgb.b | 0 };
    this._suppressUntil = Date.now() + SUPPRESS_PUSH_MS;
    // If we are mid-reconnect, keep the value and flush it once authenticated.
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
      // The socket died with a value still queued: keep it for the next flush rather
      // than record a colour CSP never received.
      if (!this._pendingWrite) this._pendingWrite = rgb;
      return;
    }
    // Reflect the value we just asked for, so the next poll does not read it
    // back as a change and nudge the picker.
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
    this.client.setColorRgb(rgb.r, rgb.g, rgb.b).catch(() => { /* surfaced via status */ });
    this._fastUntil = Date.now() + POLL_FAST_WINDOW_MS;
    // Hold this value against the host for a moment, and remember the whole burst
    // (what the host was showing, and every value we wrote) so a lagging echo of
    // any of them cannot pull the picker around.
    if (!this._written) {
      this._burstBase = prev.rgb ? { ...prev.rgb } : null;
      this._recentWrites = [];
    }
    this._recentWrites.push({ r: rgb.r, g: rgb.g, b: rgb.b });
    if (this._recentWrites.length > 8) this._recentWrites.shift();
    this._written = { r: rgb.r, g: rgb.g, b: rgb.b, until: Date.now() + WRITE_GRACE_MS };
    // Reflect the write to every window (e.g. the palette and a floated module),
    // so they stay in step without waiting for a differing poll.
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

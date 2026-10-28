'use strict';

// The IPC transport (docs/STATE.md, §12.4).
//
// the token layer's `SyncClient` lifecycle, adapted to run over injected IPC instead of
// a WebSocket: a handshake with a timeout, a keepalive that reaps a silent peer,
// exponential backoff on reconnect, and a manual-disconnect guard so a deliberate
// close never triggers a reconnect. It is Electron-free (the scheduler and `send`
// are injected) so the lifecycle is unit-tested (test/ipc-transport.test.js).
//
// The transport tracks a window's liveness; the same shape can be reused
// over a MessagePort.

const Transport = require('../../shared/transport');

const CLOSED = 'idle';
const CONNECTING = 'connecting';
const CONNECTED = 'connected';
const DISCONNECTED = 'disconnected';

/**
 * @param {object} opts
 * @param {(channel: string, payload: object) => void} opts.send
 * @param {object} [opts.clock] `{ setTimeout, clearTimeout, now }` (injectable)
 * @param {number} [opts.timeoutMs] handshake timeout
 * @param {number} [opts.keepaliveMs] ping interval once connected
 * @param {number} [opts.maxMissed] missed pongs before the peer is reaped
 * @param {{min:number,max:number}} [opts.backoff] reconnect backoff bounds
 */
function createIpcTransport({
  send,
  clock = {},
  timeoutMs = 5000,
  keepaliveMs = 30000,
  maxMissed = 2,
  backoff = { min: 1000, max: 30000 },
} = {}) {
  const setT = clock.setTimeout || setTimeout;
  const clearT = clock.clearTimeout || clearTimeout;
  const now = clock.now || (() => Date.now());

  let state = CLOSED;
  let manual = false;
  let missed = 0;
  let attempt = 0;
  let handshakeTimer = null;
  let keepaliveTimer = null;
  let reconnectTimer = null;

  const messageFns = new Set();
  const openFns = new Set();
  const closeFns = new Set();

  const fire = (set, data) => { for (const fn of [...set]) { try { fn(data); } catch { /* keep going */ } } };
  const onMessage = (fn) => { messageFns.add(fn); return () => messageFns.delete(fn); };
  const onOpen = (fn) => { openFns.add(fn); return () => openFns.delete(fn); };
  const onClose = (fn) => { closeFns.add(fn); return () => closeFns.delete(fn); };

  function clearTimers() {
    if (handshakeTimer) { clearT(handshakeTimer); handshakeTimer = null; }
    if (keepaliveTimer) { clearT(keepaliveTimer); keepaliveTimer = null; }
    if (reconnectTimer) { clearT(reconnectTimer); reconnectTimer = null; }
  }

  function scheduleReconnect() {
    if (manual) return;
    const delay = Math.min(backoff.max, backoff.min * 2 ** attempt);
    attempt += 1;
    reconnectTimer = setT(() => { reconnectTimer = null; connect(); }, delay);
  }

  function startKeepalive() {
    if (keepaliveTimer) clearT(keepaliveTimer);
    keepaliveTimer = setT(() => {
      keepaliveTimer = null;
      tick();
    }, keepaliveMs);
  }

  function tick() {
    if (state !== CONNECTED) return;
    missed += 1;
    if (missed > maxMissed) { drop('unresponsive'); return; }
    send('peer:ping', { at: now() });
    startKeepalive();
  }

  function drop(reason) {
    clearTimers();
    state = DISCONNECTED;
    fire(closeFns, { reason });
    scheduleReconnect();
  }

  /** Begin (or retry) the handshake. */
  function connect() {
    if (manual || state === CONNECTED || state === CONNECTING) return false;
    state = CONNECTING;
    send('peer:hello', { at: now() });
    handshakeTimer = setT(() => {
      handshakeTimer = null;
      missed = 0;
      state = DISCONNECTED;
      fire(closeFns, { reason: 'handshake timeout' });
      scheduleReconnect();
    }, timeoutMs);
    return true;
  }

  /** The peer answered our handshake (`peer:welcome`). */
  function ack() {
    if (manual) return false;
    if (handshakeTimer) { clearT(handshakeTimer); handshakeTimer = null; }
    if (state === CONNECTED) return false;
    state = CONNECTED;
    missed = 0;
    attempt = 0;
    fire(openFns, { at: now() });
    startKeepalive();
    return true;
  }

  /** A pong arrived — the peer is alive. */
  function pong() {
    missed = 0;
    return true;
  }

  /** A message from the peer (handshake/keepalive handled here, rest to listeners). */
  function receive(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'welcome') return ack();
    if (message.type === 'pong') return pong();
    fire(messageFns, message);
    return true;
  }

  /** Send a message while connected. Returns whether it was sent. */
  function sendMessage(payload) {
    if (state !== CONNECTED) return false;
    send('peer:message', payload);
    return true;
  }

  /** Deliberate close: never reconnects, until `connect()` is called again. */
  function disconnect() {
    manual = true;
    clearTimers();
    state = DISCONNECTED;
    fire(closeFns, { reason: 'manual' });
    return true;
  }

  /** Allow a fresh manual connection after a `disconnect()`. */
  function reset() {
    manual = false;
    attempt = 0;
    missed = 0;
    state = CLOSED;
    return true;
  }

  return Transport.assertTransport({
    connect, send: sendMessage, onMessage, onOpen, onClose,
    isConnected: () => state === CONNECTED,
    disconnect, reset, receive, ack, pong,
    state: () => state,
    stats: () => ({ state, missed, attempt, manual }),
  });
}

module.exports = { createIpcTransport };

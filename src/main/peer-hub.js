'use strict';

// The session/peer layer (docs/STATE.md, §12.3). Main is the source/hub; every
// window is a peer. It tracks who is connected and speaks the typed event
// vocabulary, so "who is open" is a first-class, observable fact rather than an
// incidental side-effect of the window list.
//
// Free of Electron: `send(wcId, channel, payload)` and `allocatePort(wcId)` are
// injected (no port is allocated until needed; a MessagePort pair can be
// returned), so the
// peer bookkeeping is unit-tested (test/peer-hub.test.js).

const PeerEvents = require('../shared/peer-events');

/**
 * @param {object} opts
 * @param {(wcId: number, channel: string, payload: object) => void} [opts.send]
 * @param {(wcId: number) => object|null} [opts.allocatePort]
 * @param {object} [opts.events] defaults to the shared vocabulary
 */
function createPeerHub({ send, allocatePort = () => null, events = PeerEvents } = {}) {
  const peers = new Map(); // wcId -> peer
  const emitter = events.createTypedEmitter();
  let state = 'idle';
  let seq = 0;

  const list = () => [...peers.values()].map((p) => ({ ...p }));

  function setState(next) {
    if (next === state) return;
    const previous = state;
    state = next;
    emitter.emit('state', { previous, current: next });
    if (next === 'connected') emitter.emit('connected', {});
    if (next === 'disconnected') emitter.emit('disconnected', {});
    if (next === 'paired') emitter.emit('paired', { peers: list() });
  }

  /** The hub is live (main is ready). */
  const connect = () => setState('connected');

  /**
   * A window joined. Idempotent — a renderer that reloads under the same wcId
   * keeps its peer (and its id) rather than appearing twice.
   */
  function openWindow(wcId, meta = {}) {
    const existing = peers.get(wcId);
    if (existing) return { ...existing };
    const peer = {
      peerId: meta.peerId || `peer-${++seq}`,
      wcId,
      kind: meta.kind || 'window',
      title: meta.title || '',
      origin: meta.origin || '',
      icon: meta.icon || null,
      port: allocatePort(wcId),
    };
    peers.set(wcId, peer);
    if (state !== 'paired') setState('paired');
    emitter.emit('peer-connected', { peer: { ...peer } });
    return { ...peer };
  }

  /** A window left. Returns whether it was known. */
  function closeWindow(wcId) {
    const peer = peers.get(wcId);
    if (!peer) return false;
    // Close the peer's transport end if it has one, so a destroyed window does not
    // leak the main-side port (docs/STATE.md). The hub stays Electron-free — it
    // only calls `close` when the injected port provides it.
    if (peer.port && typeof peer.port.close === 'function') {
      try { peer.port.close(); } catch { /* already gone */ }
    }
    peers.delete(wcId);
    emitter.emit('peer-disconnected', { peer: { ...peer } });
    if (peers.size === 0) setState('disconnected');
    return true;
  }

  const get = (wcId) => (peers.has(wcId) ? { ...peers.get(wcId) } : null);
  const isPaired = () => peers.size > 0;
  const hasPeers = () => peers.size > 0;

  /** Emit a typed event locally (warning/error/sync from any subsystem). */
  const emitEvent = (type, data) => emitter.emit(type, data);

  /** Emit a typed event to every peer (transient; never authoritative state). */
  function broadcastEvent(type, data) {
    if (typeof send !== 'function') return 0;
    let n = 0;
    for (const p of peers.values()) { send(p.wcId, 'peer:event', { type, data }); n += 1; }
    return n;
  }

  return {
    connect, openWindow, closeWindow, get, peers: list,
    isPaired, hasPeers, on: emitter.on, emitEvent, broadcastEvent,
    state: () => state, size: () => peers.size,
  };
}

module.exports = { createPeerHub };

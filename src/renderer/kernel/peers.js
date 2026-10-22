'use strict';

// The renderer's window session (docs/STATE.md, §12.3).
//
// A thin facade over the peer layer: it owns the typed event vocabulary and the
// peer list main broadcasts, so a module can ask "who else is open" without
// knowing about IPC. The event names match token-beam (peer-connected,
// peer-disconnected, sync, warning, error).

(function () {
  const csp = window.csp;
  const Events = window.IroPeerEvents;
  const emitter = Events && Events.createTypedEmitter ? Events.createTypedEmitter() : { on: () => () => {}, emit: () => false };

  let state = 'idle';
  let peers = [];

  function setPeers(next) {
    peers = Array.isArray(next) ? next : [];
    emitter.emit('peers', peers);
  }

  if (csp && typeof csp.onPeerPeers === 'function') csp.onPeerPeers((list) => setPeers(list));
  // The peer MessagePort, when main allocated one (docs/STATE.md, §12.4). It is a
  // faster path for the peer list and typed events; the IPC listeners above stay
  // as the fallback, so a missing port never loses a message.
  if (csp && typeof csp.onPeerPort === 'function') {
    csp.onPeerPort((port) => {
      if (!port) return;
      try { port.start(); } catch { /* not transferable */ }
      port.onmessage = (e) => {
        const msg = e.data;
        if (!msg) return;
        if (msg.type === 'peers') setPeers(msg.data);
        else if (msg.type === 'event') emitter.emit(msg.eventType, msg.data);
      };
    });
  }
  if (csp && typeof csp.onPeerEvent === 'function') {
    csp.onPeerEvent((evt) => {
      if (!evt || !evt.type) return;
      if (evt.type === 'state') { state = (evt.data && evt.data.current) || state; }
      emitter.emit(evt.type, evt.data);
    });
  }

  function createWindowSession() {
    return {
      on: emitter.on,
      emit: emitter.emit,
      state: () => state,
      peers: () => peers.slice(),
      hasPeers: () => peers.length > 0,
      isPaired: () => peers.length > 0,
      /** Announce this window (kind/title) to the hub. */
      hello: (meta) => (csp && csp.peerHello ? csp.peerHello(meta) : undefined),
    };
  }

  window.Iro = window.Iro || {};
  window.Iro.peers = createWindowSession();
})();

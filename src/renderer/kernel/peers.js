'use strict';

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

  if (csp && typeof csp.onPeerPort === 'function') {
    csp.onPeerPort((port) => {
      if (!port) return;
      try { port.start(); } catch {  }
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

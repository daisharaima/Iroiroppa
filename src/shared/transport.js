/*
 * The transport contract (docs/STATE.md, §12.4).
 *
 * A transport moves session messages between main and a window. Phase 1 uses
 * `ipc-transport` (Electron IPC); Phase 3 adds a `MessagePort` transport. Both
 * implement this same surface, so the session layer never knows which is in use.
 * This module is only the contract plus a shared assertion for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroTransport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const METHODS = ['connect', 'send', 'onMessage', 'onOpen', 'onClose', 'isConnected', 'disconnect'];

  function assertTransport(transport) {
    for (const m of METHODS) {
      if (!transport || typeof transport[m] !== 'function') throw new TypeError(`transport is missing ${m}()`);
    }
    return transport;
  }

  return { METHODS, assertTransport };
});

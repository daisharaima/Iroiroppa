
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

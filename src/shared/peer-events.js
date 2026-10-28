/*
 * The typed session vocabulary (docs/STATE.md, §12.3).
 *
 * The same event names as the token layer, so the mental model transfers: one window
 * (the "source"/hub is main) pairs with its peers and both sides speak
 * `peer-connected` / `sync` / `warning` / `error`. `state` carries the lifecycle
 * (`idle → connecting → connected → paired → disconnected|error`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroPeerEvents = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATES = ['idle', 'connecting', 'connected', 'paired', 'disconnected', 'error'];
  const EVENTS = [
    'state', 'connected', 'disconnected', 'paired',
    'peer-connected', 'peer-disconnected', 'sync', 'warning', 'error',
  ];

  /** A tiny typed emitter (the token layer's `TypedEmitter`): `on/off/once/emit`. */
  function createTypedEmitter() {
    const listeners = new Map(); // type -> Set<fn>

    function on(type, fn) {
      if (typeof fn !== 'function') return () => {};
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => off(type, fn);
    }
    function off(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    }
    function once(type, fn) {
      const un = on(type, (data) => { un(); fn(data); });
      return un;
    }
    function emit(type, data) {
      const set = listeners.get(type);
      if (set) for (const fn of [...set]) { try { fn(data); } catch { /* keep going */ } }
      const all = listeners.get('*');
      if (all) for (const fn of [...all]) { try { fn({ type, data }); } catch { /* keep going */ } }
      return Boolean((set && set.size) || (all && all.size));
    }
    const count = (type) => (listeners.get(type) ? listeners.get(type).size : 0);

    return { on, off, once, emit, count };
  }

  const isState = (x) => STATES.includes(x);
  const isEvent = (x) => EVENTS.includes(x);

  return { STATES, EVENTS, createTypedEmitter, isState, isEvent };
});

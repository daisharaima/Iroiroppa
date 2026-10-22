/*
 * The compute-host RPC envelope (docs/STATE.md, §6 Phase 4 / §12.4).
 *
 * Main talks to the utility-process worker (QR decode, and any future heavy
 * module work) over a tiny request/reply protocol: `{ v, id, type, payload }` out,
 * `{ v, id, ok, value|error }` back. Pure and dependency-free, so both sides and
 * the tests share one definition of a valid message.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroCompute = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;

  const createRequest = (id, type, payload) => ({ v: VERSION, id, type, payload });
  const createReply = (id, ok, value, error) => (
    ok ? { v: VERSION, id, ok: true, value } : { v: VERSION, id, ok: false, error }
  );

  const isRequest = (m) => Boolean(m) && m.v === VERSION && m.id != null && typeof m.type === 'string';
  const isReply = (m) => Boolean(m) && m.v === VERSION && m.id != null && typeof m.ok === 'boolean';

  return { VERSION, createRequest, createReply, isRequest, isReply };
});

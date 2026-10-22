'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Compute = require('../src/shared/compute-protocol');

test('a request round-trips through the envelope guards', () => {
  const req = Compute.createRequest(1, 'qr-decode', { width: 1 });
  assert.equal(Compute.isRequest(req), true);
  assert.equal(Compute.isReply(req), false);
  assert.equal(Compute.isRequest({ v: 2, id: 1, type: 'x' }), false);
  assert.equal(Compute.isRequest({ id: 1 }), false);
});

test('a reply carries either a value or an error', () => {
  const ok = Compute.createReply(7, true, 42, null);
  assert.deepEqual(ok, { v: 1, id: 7, ok: true, value: 42 });
  assert.equal(Compute.isReply(ok), true);
  const bad = Compute.createReply(7, false, null, 'boom');
  assert.deepEqual(bad, { v: 1, id: 7, ok: false, error: 'boom' });
});

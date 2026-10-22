'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const State = require('../src/shared/state-envelope');

test('createEnvelope stamps the version', () => {
  assert.deepEqual(State.createEnvelope(), { version: 1, domains: {} });
});

test('withDomain adds and replaces a domain without mutating the input', () => {
  const a = State.createEnvelope({ x: { rev: 1, value: 1 } });
  const b = State.withDomain(a, 'y', 1, 2);
  assert.deepEqual(Object.keys(b.domains), ['x', 'y']);
  assert.deepEqual(Object.keys(a.domains), ['x']);
  const c = State.withDomain(b, 'y', 2, 3);
  assert.deepEqual(c.domains.y, { rev: 2, value: 3 });
});

test('isEnvelope / normalizeEnvelope reject the wrong shape', () => {
  assert.equal(State.isEnvelope({ version: 1, domains: {} }), true);
  assert.equal(State.isEnvelope({ version: 2, domains: {} }), false);
  assert.equal(State.isEnvelope({ domains: {} }), false);
  assert.equal(State.isEnvelope(null), false);
  assert.equal(State.normalizeEnvelope({ version: 9 }), null);
  const ok = State.normalizeEnvelope({ version: 1, domains: { a: { rev: 1, value: 0 } } });
  assert.deepEqual(ok.domains.a, { rev: 1, value: 0 });
});

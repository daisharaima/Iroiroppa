'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Domains = require('../src/shared/state-domains');
const Model = require('../src/shared/token-model');

test('the registry lists the domains, their kinds and their owners', () => {
  assert.deepEqual(Domains.ids().sort(),
    ['capabilities', 'color', 'connection', 'health', 'history', 'layout']);
  assert.equal(Domains.kind('history'), 'tokens');
  assert.equal(Domains.kind('layout'), 'opaque');
  assert.equal(Domains.kind('health'), 'opaque');
  assert.equal(Domains.get('nope'), null);
  for (const id of Domains.ids()) {
    assert.ok(Domains.get(id).owner, `${id} declares an owner`);
  }
  assert.equal(Domains.get('layout').persisted, true);
  assert.equal(Domains.normalize('health', { csp: 'connected', compute: 'up' }).ok, true);
});

test('an opaque domain accepts any serialisable value', () => {
  assert.equal(Domains.normalize('capabilities', { companion: { available: true } }).ok, true);
  const circular = {};
  circular.self = circular;
  assert.equal(Domains.normalize('capabilities', circular).ok, false);
});

test('a token domain validates its payload', () => {
  const good = Model.createPayload(Model.createCollection('h', { 'color/01': '#123456' }));
  assert.equal(Domains.normalize('history', good).ok, true);
  assert.equal(Domains.normalize('history', { collections: 'nope' }).ok, false);
});

test('an unknown domain is rejected', () => {
  assert.equal(Domains.normalize('mystery', 1).ok, false);
});

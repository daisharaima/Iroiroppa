'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStateHub } = require('../src/main/state-hub');
const Model = require('../src/shared/token-model');

const historyOf = (hex) => Model.createPayload(Model.createCollection('history:iroiroppa', { 'color/01': hex }));

test('set validates, bumps the revision and emits once', () => {
  const emitted = [];
  const hub = createStateHub({ emit: (channel, payload) => emitted.push({ channel, payload }) });
  assert.equal(hub.set('connection', { state: 'idle' }), true);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].channel, 'state:changed');
  assert.equal(emitted[0].payload.domain, 'connection');
  assert.equal(emitted[0].payload.rev, 1);
});

test('an unchanged value neither emits nor bumps the revision', () => {
  const emitted = [];
  const hub = createStateHub({ emit: (_c, p) => emitted.push(p) });
  hub.set('connection', { state: 'idle', detail: '' });
  hub.set('connection', { state: 'idle', detail: '' });
  assert.equal(emitted.length, 1);
  assert.equal(hub.get('connection').rev, 1);
});

test('a changed value bumps the revision monotonically', () => {
  const hub = createStateHub({ emit: () => {} });
  hub.set('connection', { state: 'idle' });
  hub.set('connection', { state: 'scanning' });
  hub.set('connection', { state: 'connected' });
  assert.equal(hub.get('connection').rev, 3);
});

test('an invalid value is refused and an unknown domain is refused', () => {
  const emitted = [];
  const hub = createStateHub({ emit: (_c, p) => emitted.push(p) });
  assert.equal(hub.set('history', { collections: 'nope' }), false);
  assert.equal(hub.set('mystery', 1), false);
  assert.equal(hub.set('history', historyOf('#123456')), true);
  assert.equal(emitted.length, 1);
});

test('snapshot reports the full envelope', () => {
  const hub = createStateHub({ emit: () => {} });
  hub.set('connection', { state: 'idle' });
  hub.set('history', historyOf('#000000'));
  assert.deepEqual(hub.snapshot(), {
    version: 1,
    domains: {
      connection: { rev: 1, value: { state: 'idle' } },
      history: { rev: 1, value: historyOf('#000000') },
    },
  });
});

test('local listeners fire too', () => {
  const hub = createStateHub({ emit: () => {} });
  const seen = [];
  hub.on((c) => seen.push(c.domain));
  hub.set('capabilities', {});
  assert.deepEqual(seen, ['capabilities']);
});

test('a throwing emit does not abort the state update', () => {
  const hub = createStateHub({ emit: () => { throw new Error('Object has been destroyed'); } });
  assert.equal(hub.set('connection', { state: 'connected' }), true);
  assert.deepEqual(hub.get('connection').value, { state: 'connected' });
});

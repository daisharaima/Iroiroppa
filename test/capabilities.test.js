'use strict';

// The capability layer (docs/ARCHITECTURE.md): the pure model, the main
// registry that follows the Companion service, and the manifest's declarations.

const test = require('node:test');
const assert = require('node:assert/strict');

const cap = require('../src/shared/capabilities');
const { createMainCapabilities, flagList } = require('../src/main/capabilities');
const Manifest = require('../src/shared/module-manifest');

test('createCapabilities reports a live set and only emits on change', () => {
  const c = cap.createCapabilities({ channels: { companion: { available: false, reason: 'no' } } });
  assert.equal(c.state().companion.available, false);
  let calls = 0;
  c.on(() => { calls += 1; });
  assert.equal(c.set('companion', { available: false, reason: 'no' }), false, 'no change means no emit');
  assert.equal(calls, 0);
  assert.equal(c.set('companion', { available: true, reason: '' }), true);
  assert.equal(calls, 1);
  assert.equal(c.get('companion').available, true);
});

test('availability separates required from optional', () => {
  const state = {
    companion: { available: false, reason: 'not connected' },
    stub: { available: true, reason: '' },
  };
  const required = cap.availability({ capabilities: { companion: 'required', stub: 'optional' } }, state);
  assert.equal(required.ok, false);
  assert.match(required.unavailable, /companion unavailable/);
  assert.equal(required.missingRequired.length, 1);

  const optional = cap.availability({ capabilities: { companion: 'optional' } }, state);
  assert.equal(optional.ok, true);
  assert.equal(optional.missingOptional.length, 1);

  const none = cap.availability({}, state);
  assert.equal(none.ok, true);
  assert.equal(none.unavailable, '');
});

test('the main registry follows the Companion service status', () => {
  const listeners = {};
  const service = {
    state: 'idle',
    status() { return { state: this.state }; },
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
  };
  const sent = [];
  const c = createMainCapabilities({ service, broadcast: (ch, p) => sent.push([ch, p]), argv: [] });
  assert.equal(c.get('companion').available, false);
  assert.equal(c.get('stub').available, true, 'the stub is always available');

  service.state = 'connected';
  for (const fn of listeners.status) fn(service.status());
  assert.equal(c.get('companion').available, true);
  assert.equal(sent.at(-1)[0], 'capabilities:changed');
});

test('flagList parses the dev flags', () => {
  assert.deepEqual(flagList('cap-off', ['--cap-off=companion, capture']), ['companion', 'capture']);
  assert.deepEqual(flagList('cap-off', []), []);
});

test('--cap-off forces a channel unavailable for a shot', () => {
  const service = { status: () => ({ state: 'connected' }), on() {} };
  const c = createMainCapabilities({ service, argv: ['--cap-off=companion'] });
  assert.equal(c.get('companion').available, false);
  assert.match(c.get('companion').reason, /cap-off/);
});

test('the bundled manifest declares capabilities', () => {
  assert.deepEqual(Manifest.get('csp-color').capabilities, { companion: 'optional' });
  assert.deepEqual(Manifest.get('session').capabilities, { companion: 'optional' });
});

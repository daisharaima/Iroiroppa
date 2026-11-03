'use strict';

// The helper-health registry: which implementation serves each native capability, and
// whether the app is running degraded.

const test = require('node:test');
const assert = require('node:assert');
const { HelperHealth, CAPABILITIES } = require('../src/main/helper-health.js');

test('an unreported capability is pending, not degraded', () => {
  // A profile with no bare-key binding never reports `keys`; that must not leave a
  // permanent warning.
  const health = new HelperHealth();
  assert.equal(health.summary().state, 'healthy');
  assert.deepEqual(health.summary().pending, CAPABILITIES);
  assert.match(health.describe(), /not yet reported/);

  for (const name of CAPABILITIES) health.set(name, 'host');
  assert.equal(health.summary().state, 'healthy');
  assert.equal(health.describe(), 'native helpers healthy');
});

test('a capability on PowerShell is degraded and named', () => {
  const health = new HelperHealth();
  for (const name of CAPABILITIES) health.set(name, 'host');
  assert.equal(health.set('pointer', 'ps'), true);

  const summary = health.summary();
  assert.equal(summary.state, 'degraded');
  assert.deepEqual(summary.onFallback, ['pointer']);
  assert.match(health.describe(), /on PowerShell: pointer/);
});

test('everything unavailable is down', () => {
  const health = new HelperHealth();
  for (const name of CAPABILITIES) health.set(name, 'down');
  assert.equal(health.summary().state, 'down');
  assert.equal(health.summary().unavailable.length, CAPABILITIES.length);
});

test('changed fires only on a real transition', () => {
  const health = new HelperHealth();
  const events = [];
  health.on('changed', (event) => events.push(event));

  health.set('band', 'host');
  health.set('band', 'host');
  health.set('band', 'ps');
  health.set('band', 'ps');

  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => `${event.from}->${event.to}`), ['unknown->host', 'host->ps']);
  assert.equal(events[1].summary.onFallback.length, 1);
});

test('an unknown capability is ignored rather than invented', () => {
  const health = new HelperHealth();
  assert.equal(health.set('teleport', 'host'), false);
  assert.equal(health.get('teleport'), undefined);
});

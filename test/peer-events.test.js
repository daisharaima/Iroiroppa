'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SE = require('../src/shared/peer-events');

test('the vocabulary matches token-beam', () => {
  assert.deepEqual(SE.STATES, ['idle', 'connecting', 'connected', 'paired', 'disconnected', 'error']);
  assert.ok(SE.EVENTS.includes('peer-connected'));
  assert.ok(SE.EVENTS.includes('peer-disconnected'));
  assert.ok(SE.EVENTS.includes('sync'));
  assert.ok(SE.EVENTS.includes('warning'));
  assert.ok(SE.EVENTS.includes('error'));
});

test('isState / isEvent guard the vocabulary', () => {
  assert.equal(SE.isState('paired'), true);
  assert.equal(SE.isState('nope'), false);
  assert.equal(SE.isEvent('sync'), true);
  assert.equal(SE.isEvent('nope'), false);
});

test('the typed emitter delivers, unsubscribes and supports once', () => {
  const e = SE.createTypedEmitter();
  const seen = [];
  const un = e.on('sync', (d) => seen.push(['sync', d]));
  e.on('*', ({ type }) => seen.push(['*', type]));
  assert.equal(e.emit('sync', 1), true);
  un();
  e.emit('sync', 2);
  assert.deepEqual(seen, [['sync', 1], ['*', 'sync'], ['*', 'sync']]);

  const once = [];
  e.once('warning', (d) => once.push(d));
  e.emit('warning', 'a');
  e.emit('warning', 'b');
  assert.deepEqual(once, ['a']);
});

test('emitting an event with no listeners returns false and never throws', () => {
  const e = SE.createTypedEmitter();
  assert.equal(e.emit('error', {}), false);
  e.on('error', () => { throw new Error('boom'); });
  assert.doesNotThrow(() => e.emit('error', {}));
});

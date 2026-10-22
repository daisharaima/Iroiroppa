'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/shared/token-model');

test('inferType maps a value to a token type', () => {
  assert.equal(Model.inferType('#abc'), 'color');
  assert.equal(Model.inferType('#11223344'), 'color');
  assert.equal(Model.inferType(3), 'number');
  assert.equal(Model.inferType(true), 'boolean');
  assert.equal(Model.inferType('hello'), 'string');
});

test('resolveToken honours an explicit known type over inference', () => {
  assert.deepEqual(Model.resolveToken('n', '#fff'), { name: 'n', type: 'color', value: '#fff' });
  assert.deepEqual(Model.resolveToken('n', '#fff', 'number'), { name: 'n', type: 'number', value: '#fff' });
  // an unknown type falls back to inference
  assert.equal(Model.resolveToken('n', 1, 'nope').type, 'number');
});

test('isHexColor accepts 3/4/6/8 digits and rejects the rest', () => {
  for (const ok of ['#abc', '#abcd', '#112233', '#11223344']) assert.ok(Model.isHexColor(ok), ok);
  for (const no of ['abc', '#12', '#12345', 'rgb(1,2,3)', '']) assert.ok(!Model.isHexColor(no), no);
});

test('createCollection wraps a token map in one mode', () => {
  const c = Model.createCollection('colors', { primary: '#0066cc' });
  assert.deepEqual(c, {
    name: 'colors',
    modes: [{ name: 'Value', tokens: [{ name: 'primary', type: 'color', value: '#0066cc' }] }],
  });
});

test('createMultiModeCollection makes one mode per key', () => {
  const c = Model.createMultiModeCollection('c', { Light: { bg: '#fff' }, Dark: { bg: '#000' } });
  assert.deepEqual(c.modes.map((m) => m.name), ['Light', 'Dark']);
  assert.equal(c.modes[1].tokens[0].value, '#000');
});

test('tokensByType flattens and filters across collections', () => {
  const payload = Model.createPayload(
    Model.createCollection('a', { x: '#111111' }),
    Model.createCollection('b', { y: 2, z: '#222222' }),
  );
  const colors = Model.tokensByType(payload, ['color']);
  assert.deepEqual(colors.map((e) => e.token.value), ['#111111', '#222222']);
  assert.equal(colors[0].collection, 'a');
});

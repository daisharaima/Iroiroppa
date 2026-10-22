'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Schema = require('../src/shared/token-schema');
const Model = require('../src/shared/token-model');

const valid = () => Model.createPayload(
  Model.createCollection('palette:iroiroppa', { 'color/01': '#ff0000', 'color/02': '#00ff00' }),
);

test('validateTokenPayload accepts a well-formed payload', () => {
  const r = Schema.validateTokenPayload(valid());
  assert.equal(r.ok, true);
  assert.ok(r.value.collections.length === 1);
});

test('validateTokenPayload rejects malformed shapes without throwing', () => {
  for (const bad of [null, {}, { collections: 1 }, { collections: [{}] },
    { collections: [{ name: 'c', modes: [{ name: 'm', tokens: [{ name: 'x', type: 'nope', value: 1 }] }] }] }]) {
    const r = Schema.validateTokenPayload(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(typeof r.error, 'string');
  }
});

test('the limits are enforced', () => {
  const longName = 'x'.repeat(Schema.LIMITS.name + 1);
  const r = Schema.validateTokenPayload({ collections: [{ name: longName, modes: [] }] });
  assert.equal(r.ok, false);
});

test('flattenPayload tags each token with its collection and mode', () => {
  const flat = Schema.flattenPayload(valid());
  assert.equal(flat.length, 2);
  assert.equal(flat[0].collectionName, 'palette:iroiroppa');
  assert.equal(flat[0].modeName, 'Value');
});

test('filterPayloadByType drops other types and now-empty modes', () => {
  const payload = Model.createPayload(
    Model.createCollection('c', { a: '#111111', b: 5 }),
  );
  const onlyColors = Schema.filterPayloadByType(payload, ['color']);
  assert.equal(onlyColors.collections[0].modes[0].tokens.length, 1);
  assert.equal(onlyColors.collections[0].modes[0].tokens[0].value, '#111111');
  // a filter that matches nothing yields no collections
  assert.deepEqual(Schema.filterPayloadByType(payload, ['boolean']), { collections: [] });
});

test('extractColorTokens returns colour tokens with their hex', () => {
  const payload = Model.createPayload(Model.createCollection('c', { a: '#abcdef', b: 'not-a-colour' }));
  const colors = Schema.extractColorTokens(payload);
  assert.equal(colors.length, 1);
  assert.equal(colors[0].hex, '#abcdef');
});

test('parseSyncMessage / isSyncMessage gate on the message type', () => {
  assert.equal(Schema.isSyncMessage({ type: 'sync' }), true);
  assert.equal(Schema.isSyncMessage({ type: 'nope' }), false);
  assert.deepEqual(Schema.parseSyncMessage('{"type":"ping"}'), { type: 'ping' });
  assert.equal(Schema.parseSyncMessage('not json'), null);
  assert.equal(Schema.parseSyncMessage('{"type":"nope"}'), null);
});

test('normalizeSessionToken canonicalises beam:// tokens', () => {
  assert.equal(Schema.normalizeSessionToken('abc123'), 'beam://ABC123');
  assert.equal(Schema.normalizeSessionToken('beam://abc123'), 'beam://ABC123');
  assert.equal(Schema.normalizeSessionToken('  fab01  '), 'beam://FAB01');
  assert.equal(Schema.normalizeSessionToken('not-a-token'), null);
  assert.equal(Schema.normalizeSessionToken(''), null);
});

test('isWarningError flags only [warn] messages', () => {
  assert.equal(Schema.isWarningError('[warn] icon rejected'), true);
  assert.equal(Schema.isWarningError('Invalid session token'), false);
  assert.equal(Schema.isWarningError(null), false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { xorCycle, obfuscateRemoteParam, authHex, makePassword, AUTH_KEY, REMOTE_KEY } =
  require('../src/main/companion/crypto');

test('authHex matches the CSP binary (AUTH_KEY, lowercase hex)', () => {
  // Golden vector from chocolatkey/clipremote: 'A'^0xB6 = 0xF7, 'B'^0xD5 = 0x97.
  assert.equal(authHex('AB'), 'f797');
});

test('authHex round-trips through the same key', () => {
  const hex = authHex('secretpw');
  const round = xorCycle(Buffer.from(hex, 'hex'), AUTH_KEY).toString('utf8');
  assert.equal(round, 'secretpw');
});

test('REMOTE_KEY obfuscation is its own inverse', () => {
  const plain = Buffer.from('192.168.1.50\t54312\tsecretpw\tG#1:2026', 'utf8');
  const once = obfuscateRemoteParam(plain);
  const twice = obfuscateRemoteParam(once);
  assert.equal(twice.toString('utf8'), plain.toString('utf8'));
  assert.notEqual(once.toString('latin1'), plain.toString('latin1'));
});

test('REMOTE_KEY first byte is 0x74', () => {
  // 'A' (0x41) ^ 0x74 = 0x35
  assert.equal(obfuscateRemoteParam(Buffer.from('A')).toString('hex'), '35');
});

test('keys are the documented 7-byte sequences', () => {
  assert.deepEqual([...REMOTE_KEY], [0x74, 0xb2, 0x92, 0x5b, 0x4a, 0x21, 0xda]);
  assert.deepEqual([...AUTH_KEY], [0xb6, 0xd5, 0x92, 0xc4, 0xa7, 0x83, 0xe1]);
});

test('makePassword is 8 unpadded base64 chars', () => {
  for (let i = 0; i < 20; i++) {
    const pw = makePassword();
    assert.equal(pw.length, 8);
    assert.match(pw, /^[A-Za-z0-9+/]{8}$/);
  }
});

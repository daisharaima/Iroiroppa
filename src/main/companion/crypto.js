'use strict';

// Auth / share-parameter obfuscation for CSP Companion Mode.
//
// Two independent 7-byte repeating-key XOR keys were recovered by
// chocolatkey/clipremote from CSP's symboled libClipStudioPaint.so:
//   - REMOTE_KEY obfuscates the QR payload's `s` parameter.
//   - AUTH_KEY   obfuscates the session passwords carried by Authenticate.
// XOR is its own inverse, so the same helper both scrambles and unscrambles.

const crypto = require('node:crypto');

const REMOTE_KEY = Buffer.from([0x74, 0xb2, 0x92, 0x5b, 0x4a, 0x21, 0xda]);
const AUTH_KEY = Buffer.from([0xb6, 0xd5, 0x92, 0xc4, 0xa7, 0x83, 0xe1]);

/** XOR `buf` with `key`, repeating the key cyclically. Returns a new Buffer. */
function xorCycle(buf, key) {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
  return out;
}

/** Scramble/descramble the QR `s` parameter bytes. */
function obfuscateRemoteParam(buf) {
  return xorCycle(buf, REMOTE_KEY);
}

/** Scramble/descramble an auth password string to its hex wire form. */
function authHex(plaintext) {
  const raw = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
  return xorCycle(raw, AUTH_KEY).toString('hex');
}

/**
 * A fresh random session password, the way the phone app makes one: six random
 * bytes base64-encoded without padding (8 ASCII chars). This is the *new* token
 * we hand the host during Authenticate, and it is what the host stores for
 * reconnects.
 */
function makePassword() {
  return crypto.randomBytes(6).toString('base64').replace(/=+$/, '');
}

module.exports = {
  REMOTE_KEY,
  AUTH_KEY,
  xorCycle,
  obfuscateRemoteParam,
  authHex,
  makePassword,
};

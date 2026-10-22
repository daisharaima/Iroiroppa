'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSecretStore } = require('../src/main/secret-store');

/** A reversible stand-in for Electron's safeStorage (base64, not real DPAPI). */
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
  decryptString: (b) => b.toString('utf8').replace(/^enc:/, ''),
};

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-secret-'));
  return path.join(dir, 'session.json');
}

test('a plaintext file is read, then upgraded to the encrypted shape on write', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ host: '127.0.0.1', password: 'hunter2' }));
  const store = createSecretStore({ file, safeStorage: fakeSafeStorage });
  assert.deepEqual(store.get(), { host: '127.0.0.1', password: 'hunter2' });
  assert.equal(store.isEncrypted(), false);
  store.set({ port: 15235 });
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.__secret, true);
  assert.equal(onDisk.v, 2);
  assert.equal(onDisk.data.password, undefined); // not in plaintext
  assert.equal(typeof onDisk.secrets.password, 'string');
  assert.equal(store.isEncrypted(), true);
});

test('an encrypted file round-trips the secret back to plaintext', () => {
  const file = tmpFile();
  const a = createSecretStore({ file, safeStorage: fakeSafeStorage });
  a.replace({ host: '10.0.0.2', password: 's3cret' });
  const b = createSecretStore({ file, safeStorage: fakeSafeStorage });
  assert.deepEqual(b.get(), { host: '10.0.0.2', password: 's3cret' });
  assert.equal(b.isEncrypted(), true);
});

test('with encryption disabled the file stays plaintext', () => {
  const file = tmpFile();
  const store = createSecretStore({ file, safeStorage: fakeSafeStorage, enabled: false });
  store.set({ host: 'h', password: 'p' });
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.__secret, undefined);
  assert.equal(onDisk.password, 'p');
});

test('a secret that cannot be decrypted is dropped, the rest survives', () => {
  const file = tmpFile();
  const broken = { ...fakeSafeStorage, decryptString: () => { throw new Error('nope'); } };
  fs.writeFileSync(file, JSON.stringify({ __secret: true, v: 2, data: { host: 'h' }, secrets: { password: 'AAAA' } }));
  const store = createSecretStore({ file, safeStorage: broken });
  assert.deepEqual(store.get(), { host: 'h' });
});

test('a malformed file is backed up and defaults are returned', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ not json');
  const store = createSecretStore({ file, safeStorage: fakeSafeStorage, defaults: { host: '' } });
  assert.deepEqual(store.get(), { host: '' });
  assert.ok(fs.existsSync(`${file}.bak`));
});

test('clear resets to defaults', () => {
  const file = tmpFile();
  const store = createSecretStore({ file, safeStorage: fakeSafeStorage, defaults: { host: '' } });
  store.set({ host: 'h', password: 'p' });
  assert.deepEqual(store.clear(), { host: '' });
});

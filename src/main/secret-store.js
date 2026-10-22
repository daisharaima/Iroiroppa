'use strict';

// Session-secret hardening (docs/STATE.md, §6; docs/PROTOCOL.md).
//
// `session.json` holds the Companion pairing password. At rest it is encrypted
// with Electron's `safeStorage` (Windows DPAPI, tied to the user account), so a
// copied file is useless on another machine. The consumer API is identical to
// JsonStore (`get`/`set`/`replace`/`clear`) and always hands back **plaintext**,
// so nothing that reads the session has to know how it is stored.
//
// The format is self-describing, so an old plaintext file keeps working and is
// upgraded to the encrypted shape on the next write:
//   v1 (plaintext): the record itself
//   v2 (encrypted): { __secret: true, v: 2, data: {...}, secrets: { password: '<base64>' } }
//
// Electron-free (the safeStorage is injected), so the format and the migration
// are unit-tested (test/secret-store.test.js).

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {object} opts
 * @param {string} opts.file absolute path to the JSON file
 * @param {object} [opts.defaults]
 * @param {string[]} [opts.secrets] fields to encrypt at rest
 * @param {object} [opts.safeStorage] Electron's safeStorage (injected)
 * @param {boolean} [opts.enabled] force plaintext when false
 */
function createSecretStore({ file, defaults = {}, secrets = ['password'], safeStorage, enabled = true } = {}) {
  let encryptedAtRest = false;
  let data = read();

  function canEncrypt() {
    return Boolean(enabled && safeStorage
      && typeof safeStorage.isEncryptionAvailable === 'function'
      && safeStorage.isEncryptionAvailable());
  }

  function decode(raw) {
    if (raw && raw.__secret === true && raw.v === 2) {
      encryptedAtRest = true;
      const out = { ...defaults, ...(raw.data || {}) };
      const stored = raw.secrets || {};
      for (const key of secrets) {
        if (typeof stored[key] !== 'string') continue;
        try {
          out[key] = safeStorage.decryptString(Buffer.from(stored[key], 'base64'));
        } catch {
          // Undecryptable (another user/machine, or a corrupt blob): drop the
          // secret and keep the rest, so the app can simply re-pair.
        }
      }
      return out;
    }
    encryptedAtRest = false;
    return { ...defaults, ...(raw || {}) };
  }

  function encode(value) {
    if (!canEncrypt()) {
      encryptedAtRest = false;
      return { ...value };
    }
    const rest = { ...value };
    const stored = {};
    for (const key of secrets) {
      if (typeof rest[key] === 'string' && rest[key]) {
        try {
          stored[key] = safeStorage.encryptString(rest[key]).toString('base64');
          delete rest[key];
        } catch { /* leave this field in plaintext rather than lose it */ }
      }
    }
    encryptedAtRest = true;
    return { __secret: true, v: 2, data: rest, secrets: stored };
  }

  function read() {
    try {
      return decode(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      // Missing or malformed: keep a copy before anything can overwrite it.
      try { fs.copyFileSync(file, `${file}.bak`); } catch { /* nothing to back up */ }
      return { ...defaults };
    }
  }

  function write() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(encode(data), null, 2), 'utf8');
    } catch (err) {
      process.emitWarning(`could not write ${file}: ${err.message}`);
    }
  }

  return {
    get: () => ({ ...data }),
    set: (patch) => { data = { ...data, ...patch }; write(); return { ...data }; },
    replace: (value) => { data = { ...value }; write(); return { ...data }; },
    clear: () => { data = { ...defaults }; write(); return { ...data }; },
    isEncrypted: () => encryptedAtRest,
  };
}

module.exports = { createSecretStore };

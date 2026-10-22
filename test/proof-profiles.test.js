'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createProofStore, describeProfileFile, COLOUR_DIR, BUNDLED_PROFILE,
} = require('../src/main/proof-profiles');

const bundled = () => fs.readFileSync(BUNDLED_PROFILE);

test('describeProfileFile reports a parseable profile and a missing one', () => {
  const ok = describeProfileFile(BUNDLED_PROFILE);
  assert.equal(ok.supported, true);
  assert.match(ok.name, /synthetic/i);
  const missing = describeProfileFile(path.join(os.tmpdir(), 'definitely-not-here.icc'));
  assert.equal(missing.supported, false);
  assert.equal(missing.error, 'file not found');
});

test('findAdobeRgbProfile picks the machine profile, findBundledProfile the shipped one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iroiroppa-icc-'));
  try {
    fs.writeFileSync(path.join(dir, 'AdobeRGB1998.icc'), bundled());
    const store = createProofStore({ settings: { get: () => ({}) }, colourDir: dir });
    assert.equal(store.findAdobeRgbProfile(), path.join(dir, 'AdobeRGB1998.icc'));
    assert.equal(store.findBundledProfile(), BUNDLED_PROFILE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getProof reads the configured profile and reports when none is set', () => {
  const store = createProofStore({ settings: { get: () => ({ proofProfile: '' }) } });
  assert.equal(store.getProof().ok, false);
  const withProfile = createProofStore({ settings: { get: () => ({ proofProfile: BUNDLED_PROFILE }) } });
  const info = withProfile.getProof();
  assert.equal(info.ok, true);
  assert.ok(info.profile.colorants);
});

test('listProofProfiles caches and clearCaches resets it', () => {
  const settings = { get: () => ({ proofProfile: '', proofProfiles: [] }) };
  const store = createProofStore({ settings, colourDir: path.join(os.tmpdir(), 'no-such-colour-dir') });
  const first = store.listProofProfiles();
  assert.equal(store.listProofProfiles(), first, 'the list is cached');
  assert.ok(first.some((p) => p.path === BUNDLED_PROFILE), 'the bundled profile is listed');
  store.clearCaches();
  assert.notEqual(store.listProofProfiles(), first, 'a fresh list after clearCaches');
});

test('COLOUR_DIR points at the Windows colour directory', () => {
  assert.match(COLOUR_DIR, /spool[\\/]drivers[\\/]color$/i);
});

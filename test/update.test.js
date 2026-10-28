'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseVersion, isNewer, checkForUpdates, pickReleaseAssets, DEFAULT_REPO } = require('../src/main/update-check');

test('parseVersion accepts tags, bare versions and prereleases', () => {
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, pre: '' });
  assert.deepEqual(parseVersion(' 0.10.0 '), { major: 0, minor: 10, patch: 0, pre: '' });
  assert.deepEqual(parseVersion('1.2.3-beta.2'), { major: 1, minor: 2, patch: 3, pre: 'beta.2' });
  assert.equal(parseVersion('nonsense'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(null), null);
});

test('isNewer compares semver and prereleases', () => {
  assert.equal(isNewer('v1.0.0', '0.10.0'), true);
  assert.equal(isNewer('0.10.0', '0.10.0'), false);
  assert.equal(isNewer('0.9.9', '0.10.0'), false);
  assert.equal(isNewer('1.0.0', '1.0.0-beta.1'), true, 'release beats its prerelease');
  assert.equal(isNewer('1.0.0-beta.1', '1.0.0'), false);
  assert.equal(isNewer('1.0.0-beta.2', '1.0.0-beta.1'), true);
  assert.equal(isNewer('garbage', '1.0.0'), false);
});

const okJson = (body) => async () => ({ ok: true, json: async () => body });

test('reports an available update with a link', async () => {
  const info = await checkForUpdates({
    currentVersion: '0.10.0',
    fetchImpl: okJson({ tag_name: 'v1.0.0', html_url: 'https://github.com/x/y/releases/tag/v1.0.0' }),
  });
  assert.equal(info.available, true);
  assert.equal(info.version, '1.0.0');
  assert.equal(info.url, 'https://github.com/x/y/releases/tag/v1.0.0');
});

test('is silent when the running version is current or ahead', async () => {
  const same = await checkForUpdates({ currentVersion: '1.0.0', fetchImpl: okJson({ tag_name: 'v1.0.0' }) });
  assert.deepEqual(same, { available: false });
  const ahead = await checkForUpdates({ currentVersion: '1.0.0', fetchImpl: okJson({ tag_name: 'v1.0.0' }) });
  assert.equal(ahead.available, false);
});

test('is silent on a bad response, a network error or a junk tag', async () => {
  const bad = await checkForUpdates({ currentVersion: '0.1.0', fetchImpl: async () => ({ ok: false }) });
  assert.deepEqual(bad, { available: false });
  const thrown = await checkForUpdates({ currentVersion: '0.1.0', fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(thrown, { available: false });
  const junk = await checkForUpdates({ currentVersion: '0.1.0', fetchImpl: okJson({ tag_name: 'nightly' }) });
  assert.deepEqual(junk, { available: false });
});

test('falls back to the known repository when there is no fetch', async () => {
  const info = await checkForUpdates({ currentVersion: '0.1.0', fetchImpl: null });
  assert.deepEqual(info, { available: false });
  assert.equal(DEFAULT_REPO, 'daisharaima/Iroiroppa');
});

test('pickReleaseAssets finds the installer and portable exe for a version', () => {
  const assets = [
    { name: 'Iroiroppa.Setup.1.2.3.exe', browser_download_url: 'https://example.test/setup.exe' },
    { name: 'Iroiroppa-Portable-1.2.3.exe', browser_download_url: 'https://example.test/portable.exe' },
    { name: 'Iroiroppa.Setup.1.2.3.blockmap', browser_download_url: 'https://example.test/setup.blockmap' },
  ];
  assert.deepEqual(pickReleaseAssets(assets, '1.2.3'), {
    setup: 'https://example.test/setup.exe',
    portable: 'https://example.test/portable.exe',
  });
  assert.deepEqual(pickReleaseAssets(assets, '9.9.9'), { setup: '', portable: '' });
  assert.deepEqual(pickReleaseAssets(null, '1.2.3'), { setup: '', portable: '' });
});

test('a release with assets returns both downloads', async () => {
  const info = await checkForUpdates({
    currentVersion: '1.2.2',
    fetchImpl: okJson({
      tag_name: 'v1.2.3',
      html_url: 'https://github.com/x/y/releases/tag/v1.2.3',
      assets: [
        { name: 'Iroiroppa.Setup.1.2.3.exe', browser_download_url: 'https://example.test/setup.exe' },
        { name: 'Iroiroppa-Portable-1.2.3.exe', browser_download_url: 'https://example.test/portable.exe' },
      ],
    }),
  });
  assert.equal(info.available, true);
  assert.deepEqual(info.downloads, {
    setup: 'https://example.test/setup.exe',
    portable: 'https://example.test/portable.exe',
  });
});

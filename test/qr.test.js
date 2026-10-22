'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { decodeConfig, encodeConfig, isShareUrl, QrDecodeError } = require('../src/main/companion/qr');

test('decodes the reference config values', () => {
  // Values from chocolatkey/clipremote's TestDecodeConfig.
  const cfg = encodeConfig({
    ips: ['192.168.0.5', '10.0.0.2'],
    port: 6789,
    password: 's3cr3t',
    generation: 'G#1:2024.01',
  });
  const decoded = decodeConfig(cfg);
  assert.deepEqual(decoded.ips, ['192.168.0.5', '10.0.0.2']);
  assert.equal(decoded.port, 6789);
  assert.equal(decoded.password, 's3cr3t');
  assert.equal(decoded.generation, 'G#1:2024.01');
});

test('the encoded URL uses the companion host', () => {
  const url = encodeConfig({ ips: ['127.0.0.1'], port: 1, password: 'p', generation: 'g' });
  assert.ok(url.startsWith('https://companion.clip-studio.com/rc/'));
  assert.match(url, /\?s=[0-9a-f]+$/);
});

test('accepts a bare hex payload as well as a URL', () => {
  const url = encodeConfig({ ips: ['192.168.1.9'], port: 41234, password: 'pw', generation: 'G#1:2022.12' });
  const hex = url.split('?s=')[1];
  const fromHex = decodeConfig(hex);
  assert.deepEqual(fromHex.ips, ['192.168.1.9']);
  assert.equal(fromHex.port, 41234);
  assert.equal(fromHex.password, 'pw');
});

test('rejects wrong host, bad hex and bad field counts', () => {
  assert.throws(() => decodeConfig('https://evil.example.com/rc/en-us?s=00'), QrDecodeError);
  assert.throws(() => decodeConfig('https://companion.clip-studio.com/rc/en-us?s=zz'), QrDecodeError);
  assert.throws(() => decodeConfig('https://companion.clip-studio.com/rc/en-us'), QrDecodeError);
  assert.throws(() => decodeConfig(''), QrDecodeError);
  // Valid hex that does not decode to four tab-separated fields.
  assert.throws(() => decodeConfig('00'), QrDecodeError);
});

test('isShareUrl gates screen-scan results', () => {
  const url = encodeConfig({ ips: ['1.2.3.4'], port: 2, password: 'p', generation: 'g' });
  assert.equal(isShareUrl(url), true);
  assert.equal(isShareUrl('https://example.com/?s=00'), false);
  assert.equal(isShareUrl('random text'), false);
});

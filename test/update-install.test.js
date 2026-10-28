'use strict';

// The manual update download/install helpers (src/main/update-install.js):
// URL allowlist, a Windows-executable check, and the detached portable replacer.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isAllowedUpdateUrl, downloadTo, assertWritableDir, portableHelperScript,
} = require('../src/main/update-install');

test('only HTTPS GitHub release/CDN URLs are accepted', () => {
  assert.equal(isAllowedUpdateUrl('https://github.com/daisharaima/Iroiroppa/releases/download/v1.2.2/Iroiroppa.Setup.1.2.2.exe'), true);
  assert.equal(isAllowedUpdateUrl('https://objects.githubusercontent.com/github-production-release-asset/x/y'), true);
  assert.equal(isAllowedUpdateUrl('https://release-assets.githubusercontent.com/x'), true);
  assert.equal(isAllowedUpdateUrl('http://github.com/x.exe'), false);
  assert.equal(isAllowedUpdateUrl('https://github.com.evil.example/x.exe'), false);
  assert.equal(isAllowedUpdateUrl('https://evilgithubusercontent.com/x.exe'), false);
  assert.equal(isAllowedUpdateUrl('file:///C:/x.exe'), false);
  assert.equal(isAllowedUpdateUrl('not a url'), false);
});

test('the portable helper waits for the app, retries the copy and starts the target', () => {
  const script = portableHelperScript({
    appPid: 1234,
    source: 'C:\\Temp\\new.exe',
    target: 'D:\\Apps\\Iroiroppa-Portable-1.2.1.exe',
  });
  assert.match(script, /PID eq 1234/);
  assert.match(script, /set "SRC=C:\\Temp\\new\.exe"/);
  assert.match(script, /set "DST=D:\\Apps\\Iroiroppa-Portable-1\.2\.1\.exe"/);
  assert.match(script, /for \/L %%i in \(1,1,30\)/);
  assert.match(script, /start "" "%DST%"/);
  assert.throws(() => portableHelperScript({ appPid: 0, source: 'a', target: 'b' }), /valid app PID/);
});

test('assertWritableDir creates and removes its probe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-update-test-'));
  try {
    assert.doesNotThrow(() => assertWritableDir(dir));
    assert.equal(fs.readdirSync(dir).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('downloadTo writes an MZ file and reports progress', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-download-test-'));
  const dest = path.join(dir, 'update.exe');
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]));
      controller.close();
    },
  });
  const progress = [];
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    url: 'https://github.com/x/y/releases/download/v1.2.2/x.exe',
    headers: new Headers({ 'content-length': '4' }),
    body,
  });
  try {
    const out = await downloadTo('https://github.com/x/y/releases/download/v1.2.2/x.exe', dest, {
      fetchImpl,
      minBytes: 2,
      onProgress: (p) => progress.push(p),
    });
    assert.equal(out.size, 4);
    assert.equal(fs.readFileSync(dest).subarray(0, 2).toString('ascii'), 'MZ');
    assert.ok(progress.some((p) => p.phase === 'ready' && p.percent === 100));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('downloadTo refuses a non-executable or a bad redirect', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-download-test-'));
  const dest = path.join(dir, 'update.exe');
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
      controller.close();
    },
  });
  try {
    await assert.rejects(
      downloadTo('https://github.com/x/y/releases/download/v1.2.2/x.exe', dest, {
        fetchImpl: async () => ({
          ok: true, status: 200, url: 'https://github.com/x/y/releases/download/v1.2.2/x.exe',
          headers: new Headers({ 'content-length': '4' }), body,
        }),
        minBytes: 2,
      }),
      /not a Windows executable/,
    );
    await assert.rejects(
      downloadTo('https://github.com/x/y/releases/download/v1.2.2/x.exe', dest, {
        fetchImpl: async () => ({
          ok: true, status: 200, url: 'https://evil.example/x.exe',
          headers: new Headers({ 'content-length': '4' }), body,
        }),
        minBytes: 2,
      }),
      /redirected to an unexpected address/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

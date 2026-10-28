'use strict';

// The manual "download and install" half of the update flow. It is deliberately
// Electron-free so the URL check, the download and the portable replace script
// can be tested with plain Node.

const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com']);

/** A release asset URL is HTTPS, on GitHub, or on its release CDN. */
function isAllowedUpdateUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.has(host) || host.endsWith('.githubusercontent.com');
}

/**
 * Download a release asset to `dest`, following GitHub's CDN redirect. Refuses
 * anything that is not a GitHub HTTPS URL (including the final redirect), a
 * non-2xx response, a tiny file, or a file that is not a Windows executable.
 *
 * @param {string} url
 * @param {string} dest
 * @param {{fetchImpl?:Function, onProgress?:Function, minBytes?:number}} [opts]
 */
async function downloadTo(url, dest, { fetchImpl = globalThis.fetch, onProgress, minBytes = 1_000_000 } = {}) {
  if (!isAllowedUpdateUrl(url)) throw new Error('That update URL is not a GitHub release link.');
  if (typeof fetchImpl !== 'function') throw new Error('Downloads are not available in this build.');
  const res = await fetchImpl(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Iroiroppa' },
  });
  if (!res || !res.ok) throw new Error(`The download failed (HTTP ${res ? res.status : 'no response'}).`);
  const finalUrl = res.url || url;
  if (!isAllowedUpdateUrl(finalUrl)) throw new Error('The download redirected to an unexpected address.');
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || typeof res.body.getReader !== 'function') throw new Error('The download had no body.');

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const fd = fs.openSync(dest, 'w');
  let received = 0;
  let reported = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      fs.writeSync(fd, chunk);
      received += chunk.length;
      const now = Date.now();
      if (onProgress && now - reported > 120) {
        reported = now;
        onProgress({
          phase: 'download',
          received,
          total,
          percent: total ? Math.min(99, Math.round((received / total) * 100)) : null,
        });
      }
    }
  } catch (err) {
    try { fs.closeSync(fd); } catch { /* already closed */ }
    try { fs.unlinkSync(dest); } catch { /* nothing to remove */ }
    throw err;
  }
  fs.closeSync(fd);

  if (received < minBytes) {
    fs.unlinkSync(dest);
    throw new Error('The downloaded file was too small to be the app.');
  }
  const head = Buffer.alloc(2);
  const h = fs.openSync(dest, 'r');
  try { fs.readSync(h, head, 0, 2, 0); } finally { fs.closeSync(h); }
  if (head.toString('ascii') !== 'MZ') {
    fs.unlinkSync(dest);
    throw new Error('The downloaded file is not a Windows executable.');
  }
  if (onProgress) onProgress({ phase: 'ready', received, total: total || received, percent: 100 });
  return { size: received };
}

/** The target folder must be writable before we quit and hand over to the helper. */
function assertWritableDir(dir) {
  const probe = path.join(dir, `.iroiroppa-write-${process.pid}.tmp`);
  fs.writeFileSync(probe, '');
  fs.unlinkSync(probe);
}

/**
 * A tiny detached `.cmd` that waits for the running app to exit, retries the
 * copy while Windows releases the old exe, starts the new one, and cleans up.
 * Kept as a script so the running exe never has to replace itself.
 */
function portableHelperScript({ appPid, source, target }) {
  if (!Number.isInteger(Number(appPid)) || Number(appPid) <= 0) throw new Error('A valid app PID is required.');
  if (!source || !target) throw new Error('Source and target are required.');
  return [
    '@echo off',
    'setlocal',
    `set "SRC=${source}"`,
    `set "DST=${target}"`,
    ':wait',
    `tasklist /FI "PID eq ${Number(appPid)}" 2>nul | find "${Number(appPid)}" >nul`,
    'if not errorlevel 1 (',
    '  ping 127.0.0.1 -n 2 >nul',
    '  goto wait',
    ')',
    ':copy',
    'attrib -R "%DST%" >nul 2>&1',
    'for /L %%i in (1,1,30) do (',
    '  copy /Y "%SRC%" "%DST%" >nul 2>&1',
    '  if not errorlevel 1 goto copied',
    '  ping 127.0.0.1 -n 2 >nul',
    ')',
    ':failed',
    'start "" "%DST%"',
    'exit /b 1',
    ':copied',
    'start "" "%DST%"',
    'del "%SRC%" >nul 2>&1',
    'exit /b 0',
  ].join('\r\n');
}

module.exports = { isAllowedUpdateUrl, downloadTo, assertWritableDir, portableHelperScript };

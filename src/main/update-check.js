'use strict';

// Checks GitHub for a newer release. Pure and dependency-free (Node's built-in
// fetch) with an injected fetch, so it is unit-testable and the app can stay
// silent when GitHub is unreachable.

const DEFAULT_REPO = 'daisharaima/Iroiroppa';

/**
 * Parse "v1.2.3" / "1.2.3-beta.1" into comparable parts, or null.
 * @returns {{major:number,minor:number,patch:number,pre:string}|null}
 */
function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(text == null ? '' : text).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' };
}

/** Is `latest` a newer semver than `current`? A prerelease sorts before its release. */
function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  if (a.pre === b.pre) return false;
  if (!a.pre) return true; // 1.2.3 is newer than 1.2.3-beta
  if (!b.pre) return false; // 1.2.3-beta is older than 1.2.3
  return a.pre > b.pre; // best-effort between two prereleases
}

/**
 * @param {object} opts
 * @param {string} opts.currentVersion the running version
 * @param {Function} [opts.fetchImpl] fetch-compatible; defaults to global fetch
 * @param {string} [opts.repo] owner/name
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{available:boolean, version?:string, url?:string}>} never throws
 */
async function checkForUpdates({ currentVersion, fetchImpl = globalThis.fetch, repo = DEFAULT_REPO, timeoutMs = 5000 } = {}) {
  if (typeof fetchImpl !== 'function') return { available: false };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  timer?.unref?.();
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Iroiroppa' },
      signal: controller ? controller.signal : undefined,
    });
    if (!res || !res.ok) return { available: false };
    const data = await res.json();
    const parsed = parseVersion(data && data.tag_name);
    if (!parsed || !isNewer(data.tag_name, currentVersion)) return { available: false };
    const version = `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.pre ? `-${parsed.pre}` : ''}`;
    return {
      available: true,
      version,
      url: (data && data.html_url) || `https://github.com/${repo}/releases/latest`,
    };
  } catch {
    return { available: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { parseVersion, isNewer, checkForUpdates, DEFAULT_REPO };

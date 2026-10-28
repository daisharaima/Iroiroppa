'use strict';

// Reads the checked-in release note for the running version (the same file the
// release workflow publishes) for the What's New dialog. Electron-free so the
// version/URL/shape rules are testable.

const fs = require('node:fs');
const path = require('node:path');

const REPO = 'https://github.com/daisharaima/Iroiroppa';

/** `release-notes/v<version>.md` under an app root (repo root in dev, app.asar when packaged). */
function noteFile(root, version) {
  return path.join(String(root || ''), 'release-notes', `v${version}.md`);
}

/** The public release page for this version. */
function releaseUrl(version) {
  return `${REPO}/releases/tag/v${version}`;
}

/**
 * The note for `version`, or null when there is none (a dev build ahead of the
 * checked-in notes, or a build made without the release-notes folder).
 * @returns {{version:string, markdown:string, url:string}|null}
 */
function read(root, version) {
  if (!version) return null;
  try {
    const markdown = fs.readFileSync(noteFile(root, version), 'utf8');
    if (!markdown.trim()) return null;
    return { version, markdown, url: releaseUrl(version) };
  } catch {
    return null;
  }
}

module.exports = { REPO, noteFile, releaseUrl, read };

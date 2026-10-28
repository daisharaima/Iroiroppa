'use strict';

// The credits/allowlist data and the packaging that makes the license texts
// available offline in the About tab.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { links, credits, ALLOWED_URLS } = require('../src/shared/credits');

test('every credit has a name, a role, a license and only https links', () => {
  assert.ok(credits.length >= 10);
  for (const credit of credits) {
    assert.ok(credit.name, 'a credit has no name');
    assert.ok(credit.role, `${credit.name} has no role`);
    assert.equal(typeof credit.license, 'string', `${credit.name} has no license field`);
    if (credit.url) assert.match(credit.url, /^https:\/\//, `${credit.name} has a non-https link`);
    if (credit.url) assert.ok(ALLOWED_URLS.has(credit.url), `${credit.url} is not in ALLOWED_URLS`);
  }
});

test('the project links and the author link are allowed', () => {
  for (const url of [links.repo, links.releases, links.latest, links.issues, links.author]) {
    assert.ok(ALLOWED_URLS.has(url), `${url} is missing from ALLOWED_URLS`);
  }
});

test('the license documents and release notes are packaged', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = pkg.build.files;
  for (const entry of ['LICENSE', 'NOTICE', 'THIRD_PARTY.md', 'release-notes/**/*.md']) {
    assert.ok(files.includes(entry), `${entry} is not in build.files`);
  }
});

test('THIRD_PARTY.md names the shipped third-party work', () => {
  const text = fs.readFileSync(path.join(ROOT, 'THIRD_PARTY.md'), 'utf8');
  for (const name of ['jsqr', 'jscolorengine', 'culori', 'helmlab', 'Inter', 'DejaVu']) {
    assert.match(text, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `THIRD_PARTY.md has no ${name}`);
  }
});

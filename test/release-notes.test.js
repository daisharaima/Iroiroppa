'use strict';

// Release notes are user-facing and must stay consistent. Each release file is
// published verbatim by the release workflow, so this test guards the shape that
// the workflow and docs/RELEASE.md promise:
//
//   ## Highlights  (first)
//   ## Added / Changed / Fixed / Removed / Internal (optional)
//   ## Install
//   ## Requirements

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const NOTES = path.join(__dirname, '..', 'release-notes');
const pkg = require('../package.json');

const ORDER = ['Highlights', 'Added', 'Changed', 'Fixed', 'Removed', 'Internal', 'Install', 'Requirements'];
const FORBIDDEN = /\b(ROADMAP|PARKED|_private|private notes|roadmap|parked list)\b/i;

function noteFiles() {
  return fs.readdirSync(NOTES)
    .filter((name) => /^v\d+\.\d+\.\d+\.md$/.test(name))
    .sort();
}

function headings(text) {
  return [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
}

test('every release note has the required structure', () => {
  const files = noteFiles();
  assert.ok(files.length > 0, 'release-notes/ has no versioned notes');
  for (const file of files) {
    const text = fs.readFileSync(path.join(NOTES, file), 'utf8');
    const found = headings(text);
    assert.deepEqual(found.slice(0, 1), ['Highlights'], `${file}: Highlights must be the first section`);
    assert.ok(found.includes('Install'), `${file}: missing Install`);
    assert.ok(found.includes('Requirements'), `${file}: missing Requirements`);
    const rank = found.map((h) => ORDER.indexOf(h));
    assert.ok(rank.every((i) => i >= 0), `${file}: unknown section (${found.join(', ')})`);
    assert.deepEqual(rank, [...rank].sort((a, b) => a - b), `${file}: sections are out of order`);
    assert.equal(new Set(found).size, found.length, `${file}: duplicate section`);
    assert.doesNotMatch(text, FORBIDDEN, `${file}: release notes must not mention private planning`);
  }
});

test('the current package version has a release note', () => {
  assert.ok(fs.existsSync(path.join(NOTES, `v${pkg.version}.md`)), `missing release-notes/v${pkg.version}.md`);
});

test('the template keeps the same sections', () => {
  const text = fs.readFileSync(path.join(NOTES, 'TEMPLATE.md'), 'utf8');
  const found = headings(text);
  assert.deepEqual(found, ['Highlights', 'Added', 'Changed', 'Fixed', 'Removed', 'Internal', 'Install', 'Requirements']);
  assert.doesNotMatch(text, FORBIDDEN);
});

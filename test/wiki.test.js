'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { check, pagesOnDisk } = require('../scripts/wiki.js');

const WIKI = path.join(__dirname, '..', 'wiki');
const read = (file) => fs.readFileSync(path.join(WIKI, file), 'utf8');

test('the user guide passes its own gates', () => {
  const { problems } = check();
  assert.deepEqual(problems, [], `wiki problems:\n${problems.join('\n')}`);
});

test('the user guide is a real guide, not a set of stubs', () => {
  for (const page of pagesOnDisk()) {
    const words = read(page).split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 120, `${page} has only ${words} words`);
  }
});

test('the entry page links to the four things a beginner needs', () => {
  const home = read('Home.md');
  for (const page of ['Install.md', 'Connect-to-Clip-Studio-Paint.md', 'Pick-a-color.md', 'Troubleshooting.md']) {
    assert.ok(home.includes(`](${page})`), `Home.md does not link to ${page}`);
  }
});

test('the guide does not promise a GitHub wiki the repo cannot have', () => {

  for (const page of pagesOnDisk()) {
    assert.ok(!/github\.com\/[^)\s]+\/wiki/.test(read(page)), `${page} links to a wiki page`);
  }
});

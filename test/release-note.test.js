'use strict';

// The What's New note reader (src/shared/release-note.js): it must keep the note's
// headings/bullets/bold/code, stop before the Install/Requirements tail, and never
// hand raw markup to the dialog.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parse, inline } = require('../src/shared/release-note');

const SAMPLE = [
  '## Highlights',
  '',
  '- **A bold lead.** One or two sentences.',
  '- Plain bullet with `code`.',
  '',
  '## Added',
  '',
  '- A new capability.',
  '',
  '## Install',
  '',
  'Download `Iroiroppa.Setup.1.2.3.exe`.',
].join('\n');

test('headings, bullets and inline styles are split into blocks', () => {
  const blocks = parse(SAMPLE);
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'bullet', 'bullet', 'heading', 'bullet']);
  assert.equal(blocks[0].parts[0].text, 'Highlights');
  const bold = blocks[1].parts[0];
  assert.equal(bold.bold, true);
  assert.equal(bold.text, 'A bold lead.');
  const code = blocks[2].parts.find((p) => p.code);
  assert.equal(code.text, 'code');
});

test('the note stops before the Install tail', () => {
  const blocks = parse(SAMPLE);
  assert.ok(!blocks.some((b) => JSON.stringify(b).includes('Iroiroppa.Setup')));
});

test('inline() leaves unknown markup as text', () => {
  const parts = inline('[link](https://example.com) and <b>x</b>');
  assert.equal(parts.map((p) => p.text).join(''), '[link](https://example.com) and <b>x</b>');
});

test('an empty note is an empty block list', () => {
  assert.deepEqual(parse(''), []);
  assert.deepEqual(parse(null), []);
});

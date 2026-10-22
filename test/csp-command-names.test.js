'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { humanizeCommand, commandName } = require('../src/shared/csp-command-names');

test('common CSP ids get their real names', () => {
  assert.equal(humanizeCommand('filenew'), 'New');
  assert.equal(humanizeCommand('filenewfromclipboard'), 'New from Clipboard');
  assert.equal(humanizeCommand('filesaveas'), 'Save As');
  assert.equal(humanizeCommand('editclearoutofselectarea'), 'Delete Outside Selection');
});

test('unknown ids are humanized, never raw lowercase', () => {
  const name = humanizeCommand('layernewrasterlayer');
  assert.equal(name, 'Layer: New Raster Layer');
  assert.notEqual(name, 'layernewrasterlayer');
  assert.equal(humanizeCommand(''), 'Unknown command');
});

test('a local CSP label wins over the fallback', () => {
  assert.equal(commandName('filenew', 'Neu'), 'Neu');
  assert.equal(commandName('filenew', ''), 'New');
});

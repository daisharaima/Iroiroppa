'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAccel, sameAccel, cspOwner } = require('../src/shared/csp-accel');

const LIST = {
  commands: [
    { command: 'menu_new_layer', label: 'New Layer', accels: ['Ctrl+G'] },
    { command: 'menu_save', label: 'Save', accels: ['Ctrl+S', 'Ctrl+Shift+S'] },
  ],
  tools: [
    { name: 'Soft 2', key: 'E', kind: 'tool' },
    { name: 'LINE', key: 'Z', kind: 'tool' },
    { name: 'Ink', key: 'Y', kind: 'brush' },
  ],
};

test('an accelerator parses across both vocabularies', () => {
  assert.deepEqual(parseAccel('Ctrl+Shift+G'), { ctrl: true, shift: true, alt: false, meta: false, key: 'g' });
  assert.deepEqual(parseAccel('ctrl+alt+Super+F5'), { ctrl: true, shift: false, alt: true, meta: true, key: 'f5' });
  assert.deepEqual(parseAccel('E'), { ctrl: false, shift: false, alt: false, meta: false, key: 'e' });
  assert.equal(sameAccel('Ctrl+G', 'ctrl+g'), true);
  assert.equal(sameAccel('E', 'e'), true);
  assert.equal(sameAccel('E', 'Ctrl+E'), false);
  assert.equal(sameAccel('', ''), false, 'an empty accelerator never matches');
});

test('a CSP command owns its chords', () => {
  assert.equal(cspOwner('ctrl+g', LIST).label, 'New Layer');
  assert.equal(cspOwner('Ctrl+Shift+S', LIST).label, 'Save', 'the second accelerator counts');
  assert.equal(cspOwner('ctrl+shift+g', LIST), null, 'an extra modifier is a different chord');
});

test('a CSP tool owns its bare letter', () => {

  const owner = cspOwner('E', LIST);
  assert.deepEqual(owner, { label: 'Soft 2', kind: 'tool' });
  assert.deepEqual(cspOwner('e', LIST), { label: 'Soft 2', kind: 'tool' });
  assert.deepEqual(cspOwner('Y', LIST), { label: 'Ink', kind: 'brush' });
  assert.equal(cspOwner('Ctrl+E', LIST), null, 'Shift/Alt/Ctrl makes it a chord, not the tool key');
  assert.equal(cspOwner('S', LIST), null, 'a letter no CSP tool or command uses is free');
});

test('a missing list is not a refusal', () => {
  assert.equal(cspOwner('E', null), null);
  assert.equal(cspOwner('E', {}), null);
  assert.equal(cspOwner('', LIST), null);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAccel, findConflicts, parseAccelerator, validAccelerator } = require('../src/shared/shortcut-match');

test('CSP and Electron spellings normalize to the same accelerator', () => {
  assert.equal(normalizeAccel('Ctrl+Shift+N'), 'Ctrl+Shift+N');
  assert.equal(normalizeAccel('CommandOrControl+Shift+N'), 'Ctrl+Shift+N');
  assert.equal(normalizeAccel('Shift+Control+N'), 'Ctrl+Shift+N');
  assert.equal(normalizeAccel('Alt+K'), 'Alt+K');
});

test('key aliases match', () => {
  assert.equal(normalizeAccel('Return'), normalizeAccel('Enter'));
  assert.equal(normalizeAccel('DELETE'), normalizeAccel('Delete'));
  assert.equal(normalizeAccel('NUM+'), 'NumPlus');
  assert.equal(normalizeAccel('Plus'), 'Plus');
  assert.notEqual(normalizeAccel('NUM+'), normalizeAccel('Plus'));
});

test('findConflicts reports the CSP label', () => {
  const bindings = [
    { key: 'i1:open', label: 'Open', accel: 'Ctrl+Shift+N' },
    { key: 'i1:save', label: 'Save', accel: 'Ctrl+S' },
  ];
  const conflicts = findConflicts(bindings, [
    { command: 'filenew', accel: 'Ctrl+Shift+N' },
    { command: 'filesave', accel: 'Ctrl+Alt+S' },
  ], []);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].cspLabel, 'filenew');
});

test('tool keys participate in the comparison', () => {
  const conflicts = findConflicts(
    [{ key: 'i1:tool', label: 'Tool', accel: 'Z' }],
    [],
    [{ name: 'Pencil', key: 'Z' }],
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].cspLabel, 'Tool: Pencil');
});

test('an accelerator parses to a virtual key and modifiers', () => {
  const a = parseAccelerator('Ctrl+Alt+P');
  assert.equal(a.ok, true);
  assert.equal(a.vk, 0x50);
  assert.deepEqual([a.ctrl, a.alt, a.shift, a.super], [true, true, false, false]);
  assert.equal(parseAccelerator('F8').ok, true);
  assert.equal(parseAccelerator('Shift+F12').vk, 0x7b);
  assert.equal(parseAccelerator('Ctrl+Plus').vk, 0xbb);
});

test('a bare letter is not a global shortcut but is a valid reveal key', () => {
  assert.equal(validAccelerator(''), true);
  assert.equal(validAccelerator('P'), false);
  assert.equal(validAccelerator('P', { allowBare: true }), true);
  assert.equal(parseAccelerator('P').bare, true);
  assert.equal(parseAccelerator('P').hook, true);
  assert.equal(parseAccelerator('F8').hook, false);
  assert.equal(validAccelerator('Ctrl+NotAKey'), false);
  assert.equal(validAccelerator('Ctrl+Shift+Z'), true);
});

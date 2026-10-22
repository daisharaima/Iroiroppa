'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAccel, findConflicts } = require('../src/shared/shortcut-match');

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

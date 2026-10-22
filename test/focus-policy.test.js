'use strict';

// Auto-hide follows the foreground process; there is no sticky manual-show pin.
// See src/main/focus-policy.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const { focusAction } = require('../src/main/focus-policy');

test('Clip Studio Paint shows the palette', () => {
  assert.equal(focusAction({ autoHide: true, isCsp: true }), 'show');
});

test('one of our own windows keeps it up', () => {
  assert.equal(focusAction({ autoHide: true, isOwn: true }), 'keep');
});

test('any other app hides it', () => {
  assert.equal(focusAction({ autoHide: true }), 'hide');
});

test('auto-hide off leaves visibility alone', () => {
  assert.equal(focusAction({ autoHide: false }), 'keep');
  assert.equal(focusAction({ autoHide: false, isCsp: true }), 'keep');
});

test('the text-edit grace keeps it up', () => {
  assert.equal(focusAction({ autoHide: true, grace: true }), 'keep');
});

test('a manually shown palette is not pinned: the next foreground change hides it', () => {
  // The old `manualShow` flag is gone; this is the rule that replaces it.
  assert.equal(focusAction({ autoHide: true, isOwn: false, isCsp: false, grace: false }), 'hide');
});

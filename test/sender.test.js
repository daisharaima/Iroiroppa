'use strict';

// The native sender. `toSendKeys` is the pure part;
// the PowerShell round trip is not exercised here (it needs Windows + a focused
// window).

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSender, toSendKeys } = require('../src/main/sender');

test('toSendKeys translates accelerators to the SendKeys syntax', () => {
  assert.equal(toSendKeys('Ctrl+Shift+S'), '^+s');
  assert.equal(toSendKeys('Ctrl+Z'), '^z');
  assert.equal(toSendKeys('F2'), '{F2}');
  assert.equal(toSendKeys('Delete'), '{DELETE}');
  assert.equal(toSendKeys('Ctrl+Alt+P'), '^%p');
  assert.equal(toSendKeys(''), '');
  assert.equal(toSendKeys('Ctrl'), '', 'a modifier alone is not a key');
});

test('the sender reports availability by platform', async () => {
  const win = createSender({ platform: 'win32' });
  assert.equal(win.available, true);
  const other = createSender({ platform: 'darwin' });
  assert.equal(other.available, false);
  const res = await other.sendKeys('Ctrl+S');
  assert.equal(res.ok, false);
  assert.match(res.error, /not Windows/);
});

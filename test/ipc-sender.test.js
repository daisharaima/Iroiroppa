'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isTrustedSender, isChannel255 } = require('../src/main/ipc-sender');

const live = () => ({ isDestroyed: () => false });
const dead = () => ({ isDestroyed: () => true });

test('a live sender with a live window is trusted', () => {
  assert.equal(isTrustedSender({ sender: live() }, () => live()), true);
});

test('a destroyed sender is not trusted', () => {
  assert.equal(isTrustedSender({ sender: dead() }, () => live()), false);
});

test('a sender with no window (not ours) is not trusted', () => {
  assert.equal(isTrustedSender({ sender: live() }, () => null), false);
});

test('a destroyed window is not trusted', () => {
  assert.equal(isTrustedSender({ sender: live() }, () => dead()), false);
});

test('a missing event or sender is not trusted', () => {
  assert.equal(isTrustedSender(null, () => live()), false);
  assert.equal(isTrustedSender({}, () => live()), false);
});

test('isChannel255 accepts only finite 0–255 numbers', () => {
  assert.equal(isChannel255(0), true);
  assert.equal(isChannel255(255), true);
  assert.equal(isChannel255(255.5), false);
  assert.equal(isChannel255(-1), false);
  assert.equal(isChannel255(256), false);
  assert.equal(isChannel255(NaN), false);
  assert.equal(isChannel255('10'), false);
  assert.equal(isChannel255(undefined), false);
});

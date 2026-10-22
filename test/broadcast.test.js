'use strict';

// The broadcast guard (docs/INVARIANTS.md): sending to a window is racy,
// and a throw here used to abort the state update that called it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { canSend, sendTo, sendToWebContents, broadcast } = require('../src/main/broadcast');

function fakeWin({ winDestroyed = false, wcDestroyed = false, throwOnSend = false } = {}) {
  const sent = [];
  const win = {
    isDestroyed: () => winDestroyed,
    webContents: {
      isDestroyed: () => wcDestroyed,
      send: (channel, payload) => {
        if (throwOnSend) throw new Error('Object has been destroyed');
        sent.push([channel, payload]);
      },
    },
    sent,
  };
  return win;
}

test('a live window is sent to', () => {
  const win = fakeWin();
  assert.equal(sendTo(win, 'ch', { a: 1 }), true);
  assert.deepEqual(win.sent, [['ch', { a: 1 }]]);
});

test('a destroyed window is skipped', () => {
  const win = fakeWin({ winDestroyed: true });
  assert.equal(canSend(win), false);
  assert.equal(sendTo(win, 'ch', 1), false);
  assert.equal(win.sent.length, 0);
});

test('a live window with a destroyed webContents is skipped (the reported crash)', () => {
  const win = fakeWin({ wcDestroyed: true });
  assert.equal(canSend(win), false);
  assert.equal(sendTo(win, 'ch', 1), false);
  assert.equal(win.sent.length, 0);
});

test('a throwing send does not propagate, and other windows still get the message', () => {
  const bad = fakeWin({ throwOnSend: true });
  const good = fakeWin();
  assert.doesNotThrow(() => broadcast([bad, good], 'ch', 1));
  assert.equal(sendTo(bad, 'ch', 1), false);
  assert.deepEqual(good.sent, [['ch', 1]]);
});

test('broadcast returns the number actually sent', () => {
  const windows = [fakeWin(), fakeWin({ winDestroyed: true }), fakeWin()];
  assert.equal(broadcast(windows, 'ch', 1), 2);
});

test('sendToWebContents respects isDestroyed and a throwing send', () => {
  const ok = { send: () => {}, isDestroyed: () => false };
  assert.equal(sendToWebContents(ok, 'ch', 1), true);
  const dead = { send: () => {}, isDestroyed: () => true };
  assert.equal(sendToWebContents(dead, 'ch', 1), false);
  const boom = { send: () => { throw new Error('x'); } };
  assert.equal(sendToWebContents(boom, 'ch', 1), false);
});

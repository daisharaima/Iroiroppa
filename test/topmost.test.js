'use strict';

// The topmost fallback (src/main/topmost.js): a window handle that is read the
// same way on every pointer size, and a fallback that only spawns when the
// runtime says the window is not on top.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { ensureTopmost, hwndFromBuffer } = require('../src/main/topmost');

test('hwndFromBuffer reads a little-endian pointer', () => {
  const wide = Buffer.alloc(8);
  wide.writeBigUInt64LE(0x1a2b3c4dn);
  assert.equal(hwndFromBuffer(wide), String(0x1a2b3c4d));
  const narrow = Buffer.alloc(4);
  narrow.writeUInt32LE(0xdeadbeef);
  assert.equal(hwndFromBuffer(narrow), String(0xdeadbeef));
  assert.equal(hwndFromBuffer(null), '');
  assert.equal(hwndFromBuffer(Buffer.alloc(2)), '');
});

test('the fallback is skipped when the window is already on top or gone', async () => {
  assert.equal(await ensureTopmost({ isDestroyed: () => false, isAlwaysOnTop: () => true }), true);
  assert.equal(await ensureTopmost(null), false);
  assert.equal(await ensureTopmost({ isDestroyed: () => true }), false);
  assert.equal(await ensureTopmost({ isDestroyed: () => false, isAlwaysOnTop: () => false }), false);
});

test('the fallback spawns PowerShell with the decimal handle', async () => {
  const calls = [];
  const spawnFn = (file, args) => {
    calls.push({ file, args });
    const proc = new EventEmitter();
    setImmediate(() => proc.emit('exit', 0));
    return proc;
  };
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(0x2f00n);
  const win = {
    isDestroyed: () => false,
    isAlwaysOnTop: () => false,
    getNativeWindowHandle: () => buf,
  };
  const ok = await ensureTopmost(win, { spawnFn, script: 'C:/app/topmost.ps1', now: 1 });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'powershell.exe');
  assert.ok(calls[0].args.includes('-Hwnd'), 'the handle is passed as an argument');
  assert.equal(calls[0].args[calls[0].args.length - 1], String(0x2f00));
  assert.ok(calls[0].args.includes('C:/app/topmost.ps1'));
});

test('a throttled repeat does not spawn twice', async () => {
  let spawns = 0;
  const spawnFn = () => {
    spawns += 1;
    const proc = new EventEmitter();
    setImmediate(() => proc.emit('exit', 0));
    return proc;
  };
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(0x5a5an);
  const win = { isDestroyed: () => false, isAlwaysOnTop: () => false, getNativeWindowHandle: () => buf };
  const first = await ensureTopmost(win, { spawnFn, now: 10_000 });
  const second = await ensureTopmost(win, { spawnFn, now: 10_500 });
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(spawns, 1, 'the same handle within the throttle window is skipped');
});

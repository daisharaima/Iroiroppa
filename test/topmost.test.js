'use strict';

// The native window band (src/main/topmost.js): a window handle read the same way
// on every pointer size, one long-lived helper that applies `hwnd|noActivate|topmost`
// lines, and a throttled one-shot fallback when the helper cannot run.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { ensureBand, ensureTopmost, createBand, hwndFromBuffer } = require('../src/main/topmost');

/** A fake child process: records stdin writes and can be "killed". */
function fakeProc(record) {
  const proc = new EventEmitter();
  proc.stdin = {
    destroyed: false,
    end() { this.destroyed = true; },
    on() {},
    write(chunk) { record.push(String(chunk)); },
  };
  proc.kill = () => { proc.killed = true; };
  return proc;
}

function fakeWindow(hwnd) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(hwnd));
  return {
    isDestroyed: () => false,
    isAlwaysOnTop: () => false,
    getNativeWindowHandle: () => buf,
  };
}

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

test('the band is skipped for a missing or destroyed window', async () => {
  assert.equal(await ensureBand(null), false);
  assert.equal(await ensureBand({ isDestroyed: () => true }), false);
  assert.equal(await ensureTopmost({ isDestroyed: () => false }), false);
});

test('one helper is started and every request is a line on its stdin', async () => {
  const writes = [];
  const spawns = [];
  const spawnFn = (file, args) => {
    spawns.push({ file, args });
    return fakeProc(writes);
  };
  const band = createBand({ spawnFn, script: 'C:/app/topmost.ps1' });
  assert.equal(await band.apply(fakeWindow(0x2f00)), true);
  assert.equal(await band.apply(fakeWindow(0x2f00), { topmost: false }), true);
  assert.equal(spawns.length, 1, 'the helper is started once');
  assert.equal(spawns[0].file, 'powershell.exe');
  assert.ok(spawns[0].args.includes('-Watch'));
  assert.ok(spawns[0].args.includes('C:/app/topmost.ps1'));
  assert.deepEqual(writes, ['12032|1|1\n', '12032|1|0\n']);
});

test('a text field drops the non-activating bit through the same helper', async () => {
  const writes = [];
  const band = createBand({ spawnFn: () => fakeProc(writes) });
  await band.apply(fakeWindow(0x10), { noActivate: false });
  assert.deepEqual(writes, ['16|0|1\n']);
});

test('the one-shot fallback passes the handle and the flags', async () => {
  const calls = [];
  const spawnFn = (file, args) => {
    calls.push({ file, args });
    // The helper cannot start (no stdin), so the client must fall back.
    const proc = new EventEmitter();
    proc.stdin = null;
    proc.kill = () => {};
    if (args.includes('-Watch')) proc.on = () => {};
    else setImmediate(() => proc.emit('exit', 0));
    return proc;
  };
  const band = createBand({ spawnFn, script: 'C:/app/topmost.ps1' });
  const ok = await band.apply(fakeWindow(0x2f00), { now: 1 });
  assert.equal(ok, true);
  const oneShot = calls.filter((c) => !c.args.includes('-Watch'));
  assert.equal(oneShot.length, 1);
  assert.equal(oneShot[0].file, 'powershell.exe');
  assert.ok(oneShot[0].args.includes('-Hwnd'));
  assert.ok(oneShot[0].args.includes('12032'));
  assert.equal(oneShot[0].args[oneShot[0].args.indexOf('-NoActivate') + 1], '1');
  assert.equal(oneShot[0].args[oneShot[0].args.indexOf('-Topmost') + 1], '1');
});

test('a fallback repeat inside the throttle does not spawn again', async () => {
  let oneShots = 0;
  const spawnFn = (file, args) => {
    if (!args.includes('-Watch')) oneShots += 1;
    const proc = new EventEmitter();
    proc.stdin = null;
    proc.kill = () => {};
    setImmediate(() => proc.emit('exit', 0));
    return proc;
  };
  const band = createBand({ spawnFn, throttleMs: 1200 });
  const win = fakeWindow(0x5a5a);
  assert.equal(await band.apply(win, { now: 10_000 }), true);
  assert.equal(await band.apply(win, { now: 10_500 }), true);
  assert.equal(oneShots, 1, 'the same handle inside the throttle window is skipped');
});

test('stop closes the helper', async () => {
  const writes = [];
  const proc = fakeProc(writes);
  const band = createBand({ spawnFn: () => proc });
  await band.apply(fakeWindow(0x20));
  band.stop();
  assert.equal(proc.killed, true);
});

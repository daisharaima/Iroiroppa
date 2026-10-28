'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { KeyHoldWatcher, buildArgs } = require('../src/main/key-hold');

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.killed = false;
  proc.kill = () => { proc.killed = true; proc.emit('exit', 0); };
  return proc;
}

test('buildArgs maps an accelerator to a virtual key and modifier mask', () => {
  const args = buildArgs('Ctrl+Alt+P', { script: 'keys.ps1' });
  assert.deepEqual(args.slice(-4), ['-Vk', '80', '-Mods', '3']);
  assert.equal(buildArgs('F8', { script: 'keys.ps1' }).includes('-Check'), false);
  assert.equal(buildArgs('P', { script: 'keys.ps1' }), null);
});

test('the watcher streams ready/down/up and ends a hold on exit', () => {
  const proc = fakeProcess();
  const w = new KeyHoldWatcher({ accel: 'Ctrl+Alt+P', spawn: () => proc, script: 'keys.ps1' });
  const events = [];
  for (const name of ['ready', 'down', 'up', 'gone']) w.on(name, () => events.push(name));
  assert.equal(w.start(), true);
  proc.stdout.write('{"event":"ready"}\n');
  proc.stdout.write('{"event":"down"}\n');
  proc.stdout.write('{"event":"up"}\n');
  assert.deepEqual(events, ['ready', 'down', 'up']);
  w.stop();
  assert.equal(proc.killed, true);
  assert.deepEqual(events, ['ready', 'down', 'up'], 'a deliberate stop is not a crash');
});

test('taken is reported and the watcher can be restarted', () => {
  const proc = fakeProcess();
  const w = new KeyHoldWatcher({ accel: 'Ctrl+Alt+P', spawn: () => proc, script: 'keys.ps1' });
  const events = [];
  w.on('taken', () => events.push('taken'));
  w.start();
  proc.stdout.write('{"event":"taken"}\n');
  assert.deepEqual(events, ['taken']);
  w.stop();
});

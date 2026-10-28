'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { BareKeyWatcher, buildArgs } = require('../src/main/bare-key');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.stdin.setEncoding('utf8');
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

test('bare-key args are only built for modifier-less non-F keys', () => {
  const args = buildArgs('H', { script: 'x.ps1', parentPid: 7 });
  assert.deepEqual(args.slice(-5), ['x.ps1', '-Vk', '72', '-ParentPid', '7']);
  assert.equal(buildArgs('Ctrl+H', { script: 'x.ps1' }), null);
  assert.equal(buildArgs('F8', { script: 'x.ps1' }), null);
});

test('bare-key watcher parses events and sends state over stdin', () => {
  const child = fakeChild();
  const watcher = new BareKeyWatcher({ accel: 'H', spawn: () => child, parentPid: 7 });
  const seen = [];
  watcher.on('down', () => seen.push('down'));
  watcher.on('up', () => seen.push('up'));
  let stdin = '';
  child.stdin.on('data', (chunk) => { stdin += chunk; });

  assert.equal(watcher.start(), true);
  child.stdout.write('{"event":"ready"}\n');
  child.stdout.write('{"event":"down"}\n{"event":"up"}\n');
  assert.equal(watcher.ready, true);
  assert.deepEqual(seen, ['down', 'up']);

  watcher.setActive(false);
  watcher.setTyping(true);
  assert.match(stdin, /active 0/);
  assert.match(stdin, /typing 1/);

  watcher.stop();
  assert.equal(child.killed, true);
});

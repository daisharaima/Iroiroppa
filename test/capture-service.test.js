'use strict';

// The window-capture channel's main-side service.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createCaptureService } = require('../src/main/capture-service');

test('sources lists windows and emits only when the list changes', async () => {
  let raw = [
    { id: 'window:1:0', name: 'Clip Studio Paint' },
    { id: 'window:2:0', name: 'Reference' },
  ];
  const changes = [];
  const svc = createCaptureService({ getSources: async () => raw });
  svc.on((list) => changes.push(list));
  const first = await svc.sources();
  assert.deepEqual(first, [
    { id: 'window:1:0', name: 'Clip Studio Paint', kind: 'window' },
    { id: 'window:2:0', name: 'Reference', kind: 'window' },
  ]);
  assert.equal(changes.length, 1, 'the first enumeration is a change');
  await svc.sources();
  assert.equal(changes.length, 1, 'the same list is not a change');
  raw = [{ id: 'window:1:0', name: 'Clip Studio Paint' }];
  await svc.sources();
  assert.equal(changes.length, 2, 'a closed window is a change');
});

test('sources survives a capturer that throws, and non-infinite ids', async () => {
  const svc = createCaptureService({ getSources: async () => { throw new Error('no display'); } });
  assert.deepEqual(await svc.sources(), []);
  const none = createCaptureService({});
  assert.deepEqual(await none.sources(), []);
});

test('a fake source stands in for a --shot run', async () => {
  const svc = createCaptureService({ fake: 'Fake Window' });
  assert.deepEqual(await svc.sources(), [{ id: 'fake:0', name: 'Fake Window', kind: 'window' }]);
});

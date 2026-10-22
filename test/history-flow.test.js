'use strict';

// End-to-end guard for the CSP pick path: the service's `pick` event feeds the
// fallback settle, and a pointer up in CSP commits a fresh read with
// `replaceHostHead`, so one gesture leaves one tile showing the last colour — and
// an explicit Iroiroppa commit can never land before an older host colour
// (docs/INVARIANTS.md).

const test = require('node:test');
const assert = require('node:assert');
const { CompanionService } = require('../src/main/service');
const { createHistoryRecorder } = require('../src/main/history-recorder');

const rgb = (r, g, b) => ({ r, g, b });

function wire() {
  const settings = { get: () => ({}), set: () => ({}) };
  const session = { get: () => ({}), replace: () => ({}), clear: () => ({}) };
  const svc = new CompanionService({ settings, session });
  svc.client = { alive: true, setColorRgb: () => Promise.resolve(), close: () => {} };
  let timerFn = null;
  const list = [];
  const rec = createHistoryRecorder({
    list: () => list,
    max: 100,
    save: () => {},
    broadcast: () => {},
    settleMs: 450,
    setTimer: (fn) => { timerFn = fn; return 1; },
    clearTimer: () => { timerFn = null; },
  });
  svc.on('pick', (c) => rec.observe(c));
  const fire = () => { const fn = timerFn; timerFn = null; if (fn) fn(); };
  svc.lastColor = {
    main: { rgb: rgb(1, 1, 1) }, sub: null, active: 'main', rgb: rgb(1, 1, 1), transparent: false,
  };
  return { svc, rec, fire, list };
}

test('a drag ended by a pointer up leaves one tile with the last colour', () => {
  const { svc, rec, fire, list } = wire();
  svc._emitIfChanged({ active: 'main', main: { rgb: rgb(10, 20, 30) }, rgb: rgb(10, 20, 30), transparent: false });
  svc._emitIfChanged({ active: 'main', main: { rgb: rgb(40, 50, 60) }, rgb: rgb(40, 50, 60), transparent: false });
  rec.commit(rgb(40, 50, 60), { replaceHostHead: true }); // the up's fresh read
  fire();
  assert.deepEqual(list, [rgb(40, 50, 60)]);
});

test('an explicit commit takes the gesture because the settle had not fired', () => {
  const { svc, rec, fire, list } = wire();
  svc._emitIfChanged({ active: 'main', main: { rgb: rgb(10, 20, 30) }, rgb: rgb(10, 20, 30), transparent: false });
  rec.commit(rgb(90, 80, 70));
  fire();
  assert.deepEqual(list, [rgb(90, 80, 70)]);
});

test('a non-pointer pick still lands through the fallback settle', () => {
  const { svc, fire, list } = wire();
  svc._emitIfChanged({ active: 'main', main: { rgb: rgb(10, 20, 30) }, rgb: rgb(10, 20, 30), transparent: false });
  fire();
  assert.deepEqual(list, [rgb(10, 20, 30)]);
});

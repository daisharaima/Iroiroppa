'use strict';

// The `pick` event is main's one signal that a host colour change is a real
// pick and belongs in the shared history (src/main/history-recorder.js). A pure
// slot switch, an inactive-slot-only partial, our own echo and a lagging poll
// are colour changes but not picks (docs/INVARIANTS.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const { CompanionService } = require('../src/main/service');

function makeService() {
  const settings = { get: () => ({}), set: () => ({}) };
  const session = { get: () => ({}), replace: () => ({}), clear: () => ({}) };
  const svc = new CompanionService({ settings, session });
  svc.client = { alive: true, setColorRgb: () => Promise.resolve(), close: () => {} };
  const emitted = [];
  const picks = [];
  svc.on('color', (c) => emitted.push(c));
  svc.on('pick', (rgb) => picks.push(rgb));
  return { svc, emitted, picks };
}

const rgb = (r, g, b) => ({ r, g, b });

test('a host colour change on the active slot is a pick', () => {
  const { svc, picks } = makeService();
  svc.lastColor = {
    main: { rgb: rgb(1, 2, 3) }, sub: null, active: 'main', rgb: rgb(1, 2, 3), transparent: false,
  };
  svc._emitIfChanged({
    active: 'main', main: { rgb: rgb(20, 30, 40) }, rgb: rgb(20, 30, 40), transparent: false,
  });
  assert.deepEqual(picks, [rgb(20, 30, 40)]);
});

test('an inactive-slot-only partial is not a pick', () => {
  const { svc, emitted, picks } = makeService();
  svc.lastColor = {
    main: { rgb: rgb(1, 1, 1) }, sub: { rgb: rgb(2, 2, 2) }, active: 'main', rgb: rgb(1, 1, 1),
  };
  svc._emitIfChanged({ sub: { rgb: rgb(30, 30, 30) } });
  assert.equal(emitted.length, 1, 'the slot change is still mirrored');
  assert.deepEqual(picks, []);
});

test('a pure foreground/background switch is not a pick', () => {
  const { svc, picks } = makeService();
  svc.lastColor = {
    main: { rgb: rgb(1, 1, 1) }, sub: { rgb: rgb(2, 2, 2) }, active: 'main', rgb: rgb(1, 1, 1),
  };
  svc._emitIfChanged({ active: 'sub' });
  assert.deepEqual(picks, []);
});

test('a switch that carries a new active-slot colour is a pick', () => {
  const { svc, picks } = makeService();
  svc.lastColor = {
    main: { rgb: rgb(1, 1, 1) }, sub: { rgb: rgb(2, 2, 2) }, active: 'main', rgb: rgb(1, 1, 1),
  };
  svc._emitIfChanged({ active: 'sub', sub: { rgb: rgb(50, 60, 70) } });
  assert.deepEqual(picks, [rgb(50, 60, 70)]);
});

test('our own write echo is not a pick', () => {
  const { svc, picks } = makeService();
  svc.writeColor(rgb(10, 20, 30), { immediate: true });
  svc._suppressUntil = 0;
  svc._emitIfChanged({ rgb: rgb(10, 20, 30), transparent: false });
  assert.deepEqual(picks, []);
});

test('a transparent change is not a pick', () => {
  const { svc, picks } = makeService();
  svc.lastColor = {
    main: { rgb: rgb(1, 2, 3) }, sub: null, active: 'main', rgb: rgb(1, 2, 3), transparent: false,
  };
  svc._emitIfChanged({ active: 'transparent', rgb: rgb(1, 2, 3), transparent: true });
  assert.deepEqual(picks, []);
});

test('a lagging poll revert is not a pick', () => {
  const { svc, picks } = makeService();
  svc.lastColor = {
    main: { rgb: rgb(1, 2, 3) }, sub: null, active: 'main', rgb: rgb(1, 2, 3),
  };
  svc._emitIfChanged({ active: 'main', main: { rgb: rgb(20, 30, 40) }, rgb: rgb(20, 30, 40) });
  svc._emitIfChanged({
    active: 'main', main: { rgb: rgb(1, 2, 3) }, rgb: rgb(1, 2, 3),
  }, { fromPoll: true });
  assert.deepEqual(picks, [rgb(20, 30, 40)]);
});

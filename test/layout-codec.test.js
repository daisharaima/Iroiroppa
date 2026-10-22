'use strict';

// The v1 column codec (plan P1): the board's weight/ratio vocabulary <-> the
// document's v2 height. It must round-trip losslessly for anything a v1 writer can
// express, and must leave an inexpressible (auto/px/ratio) height untouched.

const test = require('node:test');
const assert = require('node:assert/strict');
const Codec = require('../src/shared/layout-codec');

const registry = { 'm-auto': { autoHeight: true }, 'm-ratio': { defaultRatio: 1.5 }, 'm-plain': {} };
const ctx = { newId: (p) => `${p}${Math.random().toString(36).slice(2, 6)}`, registry };

test('heightToV1 names only a fill height', () => {
  assert.equal(Codec.heightToV1({ mode: 'fill', weight: 30 }), 30);
  assert.equal(Codec.heightToV1({ mode: 'fill' }), Codec.DEFAULT_WEIGHT);
  assert.equal(Codec.heightToV1({ mode: 'auto' }), null);
  assert.equal(Codec.heightToV1({ mode: 'px', px: 120 }), null);
  assert.equal(Codec.heightToV1({ mode: 'ratio', ratio: 1.5 }), null);
  assert.equal(Codec.heightToV1(null), null);
});

test('heightRatioToV1 returns the ratio only for a ratio mode', () => {
  assert.equal(Codec.heightRatioToV1({ mode: 'ratio', ratio: 1.5 }), 1.5);
  assert.equal(Codec.heightRatioToV1({ mode: 'fill', weight: 10 }), null);
});

test('heightFromV1 keeps an inexpressible stored height', () => {
  assert.deepEqual(Codec.heightFromV1(40, null, registry, 'm-plain'), { mode: 'fill', weight: 40 });
  assert.deepEqual(Codec.heightFromV1(null, { mode: 'px', px: 120 }, registry, 'm-plain'), { mode: 'px', px: 120 });
  assert.deepEqual(Codec.heightFromV1(null, { mode: 'auto' }, registry, 'm-plain'), { mode: 'auto' });
  assert.deepEqual(Codec.heightFromV1(null, null, registry, 'm-auto'), { mode: 'auto' });
  assert.deepEqual(Codec.heightFromV1(null, null, registry, 'm-ratio'), { mode: 'ratio', ratio: 1.5 });
  assert.deepEqual(Codec.heightFromV1(null, null, registry, 'm-plain'), { mode: 'fill', weight: Codec.DEFAULT_WEIGHT });
});

test('a fill column round-trips through v1', () => {
  const palette = {
    columns: [{ id: 'c1', width: 200, modules: [
      { instanceId: 'i1', moduleId: 'm-plain', height: { mode: 'fill', weight: 25 } },
      { instanceId: 'i2', moduleId: 'm-plain', height: { mode: 'fill', weight: 75 } },
    ] }],
  };
  const v1 = Codec.columnsToV1(palette);
  assert.deepEqual(v1, [{ id: 'c1', width: 200, modules: [
    { instanceId: 'i1', moduleId: 'm-plain', weight: 25, ratio: null },
    { instanceId: 'i2', moduleId: 'm-plain', weight: 75, ratio: null },
  ] }]);
  const back = Codec.columnsFromV1(v1, palette.columns, ctx);
  assert.deepEqual(back, palette.columns, 'a fill height round-trips exactly');
});

test('a px/auto height survives a v1 write untouched', () => {
  const stored = [{ id: 'c1', width: 200, modules: [
    { instanceId: 'i1', moduleId: 'm-plain', height: { mode: 'px', px: 88 } },
    { instanceId: 'i2', moduleId: 'm-auto', height: { mode: 'auto' } },
  ] }];
  const v1 = Codec.columnsToV1({ columns: stored });
  assert.equal(v1[0].modules[0].weight, null); // v1 cannot express a px height
  const back = Codec.columnsFromV1(v1, stored, ctx);
  assert.deepEqual(back[0].modules.map((m) => m.height), [{ mode: 'px', px: 88 }, { mode: 'auto' }]);
});

test('an added module with no instance id gets a fresh one', () => {
  const stored = [{ id: 'c1', width: 200, modules: [{ instanceId: 'i1', moduleId: 'm-plain', height: { mode: 'fill', weight: 50 } }] }];
  const incoming = [{ id: 'c1', width: 200, modules: [
    { moduleId: 'm-plain', weight: 50 },
    { moduleId: 'm-plain', weight: 50 },
  ] }];
  const back = Codec.columnsFromV1(incoming, stored, ctx);
  const ids = back[0].modules.map((m) => m.instanceId);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2, 'the added module gets its own id');
});

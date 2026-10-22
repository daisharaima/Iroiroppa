'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { composeView, forward, inverse, isIdentity } = require('../src/shared/slice-view');

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('identity leaves coordinates alone', () => {
  const v = composeView(0, false, false);
  assert.ok(isIdentity(v));
  assert.deepEqual(forward(v, 0.2, 0.8), { u: 0.2, v: 0.8 });
  assert.deepEqual(inverse(v, 0.2, 0.8), { u: 0.2, v: 0.8 });
});

test('quarter turns are exact', () => {
  const r90 = composeView(90, false, false);
  assert.deepEqual(forward(r90, 0, 0), { u: 1, v: 0 });
  const f180 = forward(composeView(180), 0.2, 0.8);
  assert.ok(near(f180.u, 0.8) && near(f180.v, 0.2));
  assert.deepEqual(forward(composeView(270), 0.2, 0.8), { u: 0.8, v: 0.8 });
});

test('flips are applied after rotation', () => {
  const v = composeView(90, true, false);
  const f = forward(v, 0.2, 0.8);
  assert.ok(near(f.u, 0.8));
  assert.ok(near(f.v, 0.2));
});

test('every view round-trips', () => {
  for (const rotate of [0, 90, 180, 270]) {
    for (const flipH of [false, true]) {
      for (const flipV of [false, true]) {
        const v = composeView(rotate, flipH, flipV);
        for (const u of [0, 0.13, 0.5, 0.91, 1]) {
          for (const w of [0, 0.27, 0.5, 0.73, 1]) {
            const d = forward(v, u, w);
            const back = inverse(v, d.u, d.v);
            assert.ok(near(back.u, u), `${rotate}/${flipH}/${flipV} u`);
            assert.ok(near(back.v, w), `${rotate}/${flipH}/${flipV} v`);
          }
        }
      }
    }
  }
});

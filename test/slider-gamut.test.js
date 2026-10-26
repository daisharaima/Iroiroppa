'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Gamut = require('../src/shared/slider-gamut');
const Models = require('../src/shared/color-models');
const { trackStops, fullStops } = Gamut;

const sample = (t, inside, color = `rgb(${Math.round(t * 255)},0,0)`) => ({ t, inside, color });
const pcts = (stops) => stops.map((s) => s.pct);

test('a single in-gamut interval has one hard edge on each side', () => {
  const stops = trackStops([sample(0, false), sample(0.25, false), sample(0.5, true), sample(0.75, true), sample(1, false)]);
  const edges = stops
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => i > 0 && s.pct === stops[i - 1].pct);
  assert.deepEqual(edges.map(({ s }) => s.pct), [0.5, 1]);
  const first = edges[0].i;
  assert.equal(stops[first - 1].color, 'var(--blank)');
  assert.notEqual(stops[first].color, 'var(--blank)');
});

test('two in-gamut intervals keep both edges hard', () => {
  const stops = trackStops([sample(0, true), sample(0.25, false), sample(0.75, true), sample(1, false)]);
  const edges = stops.filter((s, i) => i > 0 && s.pct === stops[i - 1].pct);
  assert.deepEqual(edges.map((s) => s.pct), [0.25, 0.75, 1]);
});

test('all in and all out are simple', () => {
  assert.deepEqual(pcts(trackStops([sample(0, true), sample(1, true)])), [0, 1]);
  assert.deepEqual(pcts(trackStops([sample(0, false), sample(1, false)])), [0, 1]);
});

test('the full-track variant ignores the mask', () => {
  const samples = [sample(0, false), sample(0.5, false), sample(1, false)];
  assert.deepEqual(pcts(fullStops(samples)), [0, 0.5, 1]);
  assert.equal(fullStops(samples)[0].color, samples[0].color);
});

test('empty input is empty, not a throw', () => {
  assert.deepEqual(trackStops([]), []);
  assert.deepEqual(fullStops(null), []);
});

test('gradientFor samples a full track and can blank the out-of-gamut part', () => {
  const model = Models.get('oklch');
  const axes = [0.6, 0.1, 30];
  const store = { cmax: () => 0.4, inGamut: () => true };
  const full = Gamut.gradientFor(model, 0, store, { axes, samples: 4, markOut: false });
  assert.match(full, /^linear-gradient\(90deg, /);
  assert.equal(full.split('%,').length, 5, 'five stops for four samples');
  const blank = Gamut.gradientFor(model, 0, { cmax: () => 0.4, inGamut: () => false }, { axes, samples: 4 });
  assert.match(blank, /var\(--blank\)/);
});

test('nearestInGamut holds the other axes and finds an in-gamut value', () => {
  const model = Models.get('oklch');
  const axes = [0.6, 0.1, 30];
  const store = { cmax: () => 0.4, inGamut: (L) => L >= 0.5 };
  const near = Gamut.nearestInGamut(model, 0, store, axes, 0.1);
  assert.ok(near >= 0.5 - 1e-9);
});

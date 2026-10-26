'use strict';

// The Color Disc's mapping (src/shared/disc-map.js). The pointer is drawn with
// `pointFromAxes` and the pick is made with `axesAt`, so they must be inverses; and a
// coloured value must never collapse to the centre (that was a visible snap).

const test = require('node:test');
const assert = require('node:assert');
const Models = require('../src/shared/color-models');
const Color = require('../src/shared/color');
const Disc = require('../src/shared/disc-map');

/** The store surface disc-map uses, over the sRGB gamut. */
const store = {
  plotKeyTag: () => 's',
  cmax: () => 0.4,
  chromaIntervals: (L, H) => Color.chromaIntervals(L, H),
  maxChroma: (L, H) => Color.maxChroma(L, H),
  inGamut: (L, C, H) => Color.inGamut(L, C, H),
  useWorkingGamut: () => false,
};

const mid = (model) => model.axes.map((a) => (a.min + a.max) / 2);

test('the disc plane is the one whose fixed axis is the light axis', () => {
  // planesFor puts the fixed-hue plane first, so the hue x chroma plane (fixed light)
  // is plane 1 for every registered model — the helper exists so a model with a
  // different role order cannot silently use the wrong slice.
  for (const id of ['okhsv', 'okhsl', 'oklch', 'cielch', 'helmgenlch']) {
    const model = Models.get(id);
    if (!model) continue;
    const lanes = Models.planesFor(model)[Disc.discPlane(model)];
    assert.equal(lanes[2], Models.lightAxis(model), `${id} fixes the light axis`);
  }
});

test('the rim is a positive model-unit radius for every hue model', () => {
  for (const id of ['okhsv', 'okhsl', 'oklch', 'cielch', 'helmgenlch']) {
    const model = Models.get(id);
    if (!model) continue;
    assert.ok(Disc.rimFor(model, store) > 0, id);
  }
});

test('pointFromAxes stays positive and round-trips with axesAt', () => {
  for (const id of ['okhsv', 'okhsl', 'oklch', 'cielch', 'helmgenlch']) {
    const model = Models.get(id);
    if (!model) continue;
    const scale = Disc.rimFor(model, store);
    for (let h = 0; h < 360; h += 30) {
      for (const frac of [0.1, 0.3, 0.6]) {
        const axes = Disc.axesAt(model, mid(model), h, frac, scale);
        const p = Disc.pointFromAxes(model, axes, scale, store);
        assert.ok(p.r > 0.01, `${id} h=${h} frac=${frac}: r=${p.r}`);
        assert.ok(Math.abs(p.r - frac) < 0.02, `${id} h=${h} frac=${frac}: r=${p.r}`);
      }
    }
  }
});

test('past the rim the pointer is pinned to the edge and flagged', () => {
  const model = Models.get('oklch');
  const scale = Disc.rimFor(model, store);
  const base = model.axes.map((a) => (a.min + a.max) / 2);
  base[1] = scale * 2; // chroma twice the rim
  const p = Disc.pointFromAxes(model, base, scale, store);
  assert.equal(p.r, 1);
  assert.equal(p.clamped, true);
});

test('a rectangular model and its polar twin land on the same circle', () => {
  const rect = Models.get('cielab');
  const polar = Models.get('cielch');
  if (!rect || !polar) return;
  const scale = Disc.rimFor(polar, store);
  // CIELAB at (L*, a, b) and CIELCH at (L*, C, H) describe the same colour.
  const L = 60;
  const C = 30;
  const H = 40;
  const rectAxes = [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)];
  const polarAxes = [L, C, H];
  const a = Disc.pointFromAxes(rect, rectAxes, scale, store);
  const b = Disc.pointFromAxes(polar, polarAxes, scale, store);
  assert.ok(Math.abs(a.r - b.r) < 1e-6, `r ${a.r} vs ${b.r}`);
  assert.ok(Math.abs(a.hue - b.hue) < 1e-6, `hue ${a.hue} vs ${b.hue}`);
});

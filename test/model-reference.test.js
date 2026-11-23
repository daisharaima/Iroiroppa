'use strict';

const test = require('node:test');
const assert = require('node:assert');

const Proof = require('../src/shared/proof');
const Color = require('../src/shared/color');
const Models = require('../src/shared/color-models');
const Ref = require('../src/shared/model-reference');

const M_ADOBE = [
  [0.5767309, 0.1855540, 0.1881852],
  [0.2973769, 0.6273491, 0.0752741],
  [0.0270343, 0.0706872, 0.9911085],
];

const adobeProof = () => {
  const colorants = Proof.mulMat(Proof.BRADFORD_D65_D50, M_ADOBE);
  const profile = { name: 'Adobe RGB (1998)', colorants, trc: { type: 'gamma', gamma: 563 / 256 } };
  return Proof.createProof(profile, 'working');
};

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('a matrix/TRC RGB profile yields a document reference, a CMYK/LUT one yields the gamut mode', () => {
  assert.strictEqual(Ref.create(adobeProof()).kind, 'document');
  assert.strictEqual(Ref.create(null).kind, 'srgb');

  const lut = Ref.create({ profile: { name: 'Coated FOGRA39', lut: {} }, maxChroma: () => 0.2 });
  assert.strictEqual(lut.kind, 'gamut');
  assert.strictEqual(lut.limited, false);

  assert.notStrictEqual(Ref.keyOf(lut), Ref.keyOf(Ref.create(adobeProof())));
  assert.strictEqual(Ref.keyOf(Ref.SRGB), 'srgb');
});

test('document record <-> OKLab round-trips through the profile', () => {
  const ref = Ref.create(adobeProof());
  for (const rgb of [[0.2, 0.5, 0.8], [1, 0, 0], [0, 1, 0], [0.5, 0.5, 0.5], [1, 1, 1]]) {
    const lab = ref.recordToOklab(rgb);
    const back = ref.recordToOklab(ref.oklabToRecord(lab));

    assert.ok(near(back.L, lab.L, 1e-6) && near(back.a, lab.a, 1e-6) && near(back.b, lab.b, 1e-6),
      `${rgb}: ${JSON.stringify(lab)} -> ${JSON.stringify(back)}`);
  }
});

test('with the document reference the three spaces reach Adobe RGB primaries', () => {
  const ref = Ref.create(adobeProof());
  Models.setReference(ref);
  try {

    for (const [rgb, name] of [[[1, 0, 0], 'red'], [[0, 1, 0], 'green'], [[0, 0, 1], 'blue'], [[0, 1, 1], 'cyan']]) {
      const lab = ref.recordToOklab(rgb);

      for (const [id, toAxes, fromAxes] of [
        ['okhsv', 'oklabToOkhsv', 'okhsvToOklab'],
        ['okhsl', 'oklabToOkhsl', 'okhslToOklab'],
      ]) {
        const a = ref.gamut[toAxes](lab.L, lab.a, lab.b);
        const p = id === 'okhsv' ? [a.s, a.v] : [a.s, a.l];
        const back = ref.gamut[fromAxes](a.h, p[0], p[1]);
        assert.ok(near(back.L, lab.L, 2e-6) && near(back.a, lab.a, 2e-6) && near(back.b, lab.b, 2e-6),
          `${id} ${name} gamut round-trip (${back.L}, ${back.a}, ${back.b})`);
      }

      for (const id of ['okhsv', 'okhsl']) {
        const model = Models.get(id);
        const axes = model.fromLab(lab);
        assert.ok(axes.every(Number.isFinite), `${id} ${name}: finite axes`);
        axes.forEach((value, i) => {
          const ax = model.axes[i];
          assert.ok(value >= ax.min - 1e-6 && value <= ax.max + 1e-6,
            `${id} ${name} axis ${ax.key}=${value} inside ${ax.min}..${ax.max}`);
        });
        const back = model.toLab(axes);
        assert.ok(near(back.L, lab.L, 1e-3) && near(back.a, lab.a, 1e-3) && near(back.b, lab.b, 1e-3),
          `${id} ${name} model round-trip (${back.L}, ${back.a}, ${back.b})`);
      }
    }
  } finally {
    Models.setReference(null);
  }
});

test('the notice follows the reference, not the model id', () => {
  const ref = Ref.create(adobeProof());
  Models.setReference(ref);
  assert.strictEqual(Models.referenceLimited(Models.get('okhsv')), false, 'document reference: not limited');
  Models.setReference(Ref.create({ profile: { name: 'FOGRA', lut: {} }, maxChroma: () => 0.2 }));
  assert.strictEqual(Models.referenceLimited(Models.get('okhsv')), false, 'gamut reference: not limited');
  Models.setReference(null);
  assert.strictEqual(Models.referenceLimited(Models.get('okhsv')), true, 'sRGB reference: notice');
  assert.strictEqual(Models.referenceLimited(Models.get('oklch')), false, 'perceptual models are never limited');
});

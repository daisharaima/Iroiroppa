'use strict';

// The colour-interop wrapper is browser code, but it only reads `window.culori` /
// `window.Color`, so Node can load it against the real culori and the real colour
// maths. This proves the guard (absent culori is inert) and the conversions.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'src', 'renderer', 'kernel', 'color-interop.js');
const Color = require('../src/shared/color');

function load({ withCulori = true } = {}) {
  const win = { Color, Iro: {} };
  if (withCulori) win.culori = require('culori');
  global.window = win;
  delete require.cache[require.resolve(FILE)];
  require(FILE);
  return win.Iro.colorInterop;
}

test('with culori present, hex converts to OKLab and back', () => {
  const ci = load();
  assert.equal(ci.available, true);
  const lab = ci.toOklab('#ff0000');
  assert.ok(lab && lab.L > 0.6 && lab.L < 0.7);
  const hex = ci.fromOklab(lab, 'rgb');
  assert.equal(hex.toUpperCase(), '#FF0000');
});

test('CSS colour strings parse to OKLab + hex', () => {
  const ci = load();
  assert.deepEqual(ci.parseCssColor('nope'), null);
  const oklch = ci.parseCssColor('oklch(0.7 0.1 250)');
  assert.ok(oklch && typeof oklch.L === 'number' && /^#[0-9A-F]{6}$/i.test(oklch.hex));
  assert.ok(ci.parseCssColor('#abc'));
});

test('difference and nearestName work over a list', () => {
  const ci = load();
  assert.ok(ci.difference('#000000', '#ffffff') > 0);
  const best = ci.nearestName('#ff0101', [{ name: 'red', hex: '#ff0000' }, { name: 'blue', hex: '#0000ff' }]);
  assert.equal(best.name, 'red');
  assert.deepEqual(ci.nearestName('#000', []), null);
});

test('without culori every method is inert and available is false', () => {
  const ci = load({ withCulori: false });
  assert.equal(ci.available, false);
  assert.equal(ci.toOklab('#fff'), null);
  assert.equal(ci.parseCssColor('oklch(0.7 0.1 250)'), null);
  assert.equal(ci.difference('#000', '#fff'), null);
  assert.equal(ci.nearestName('#000', [{ name: 'a', hex: '#fff' }]), null);
});

test('hex output, a named difference metric, and interpolation options work', () => {
  const ci = load();
  const lab = ci.toOklab('#ff0000');
  assert.equal(ci.fromOklab(lab, 'hex').toUpperCase(), '#FF0000', 'hex is a formatter, not a converter mode');
  assert.equal(typeof ci.difference('#000', '#fff', 'ciede2000'), 'number');
  const viaObject = ci.interpolate('#000000', '#ffffff', 0.5, { space: 'oklch' });
  const viaString = ci.interpolate('#000000', '#ffffff', 0.5, 'oklch');
  assert.ok(viaObject && viaString);
  assert.equal(viaObject.mode, viaString.mode);
});

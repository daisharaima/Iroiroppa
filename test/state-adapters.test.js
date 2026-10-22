'use strict';

// The per-domain adapters are browser code (they read `window.Color` and the token
// helpers). Node fakes those globals; the conversion is tested against the real
// shared colour maths, so the 0–255 / 0–1 hex convention is exercised for real.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'src', 'renderer', 'kernel', 'state-adapters.js');
const Schema = require('../src/shared/token-schema');
const Color = require('../src/shared/color');

function load() {
  const registered = [];
  const win = {
    Color,
    IroTokenSchema: Schema,
    Iro: { state: { register: (domain, fn) => { registered.push({ domain, fn }); return () => {}; } } },
  };
  global.window = win;
  delete require.cache[require.resolve(FILE)];
  require(FILE);
  return { adapters: win.Iro.stateAdapters, registered };
}

test('rgbToTokens builds a valid colour collection with stable names', () => {
  const { adapters } = load();
  const payload = adapters.rgbToTokens([{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }]);
  assert.equal(Schema.validateTokenPayload(payload).ok, true);
  assert.deepEqual(payload.collections[0].modes[0].tokens.map((t) => t.name), ['color/01', 'color/02']);
  assert.equal(payload.collections[0].modes[0].tokens[0].value.toUpperCase(), '#FF0000');
});

test('the round trip [{r,g,b}] -> tokens -> [{r,g,b}] is stable', () => {
  const { adapters } = load();
  const list = [{ r: 12, g: 34, b: 56 }, { r: 250, g: 250, b: 250 }];
  assert.deepEqual(adapters.tokensToRgb(adapters.rgbToTokens(list)), list);
});

test('the history adapter feeds the store its rgb list', () => {
  const { adapters, registered } = load();
  const store = { setHistory: (list) => { store.seen = list; } };
  adapters.history(store);
  const entry = registered.find((r) => r.domain === 'history');
  entry.fn(adapters.rgbToTokens([{ r: 1, g: 2, b: 3 }]));
  assert.deepEqual(store.seen, [{ r: 1, g: 2, b: 3 }]);
});

test('the capabilities/connection/color adapters register their domain', () => {
  const { adapters, registered } = load();
  adapters.capabilities({ set: () => {} });
  adapters.connection(() => {});
  adapters.color(() => {});
  assert.deepEqual(registered.map((r) => r.domain), ['capabilities', 'connection', 'color']);
});

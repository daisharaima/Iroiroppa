'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/shared/shortcut-model');

test('normalise fills the new shape and drops unknown keys', () => {
  const s = Model.normalise({
    app: { toggle: ' Ctrl+Alt+P ', hold: 'Ctrl+Alt+H', position: 'top-left' },
    palettes: { p1: { toggle: 'Ctrl+1' } },
    junk: 1,
  });
  assert.deepEqual(s, {
    app: {
      mode: 'toggle', toggle: 'Ctrl+Alt+P', hold: 'Ctrl+Alt+H',
      autoDismiss: false, position: 'top-left',
    },
    palettes: {
      p1: {
        mode: 'toggle', toggle: 'Ctrl+1', hold: '',
        autoDismiss: false, position: 'keep',
      },
    },
  });
});

test('an explicit mode wins; otherwise a hold-only target migrates to hold', () => {
  assert.equal(Model.normalise({ app: { mode: 'afterPick' } }).app.mode, 'afterPick');
  assert.equal(Model.normalise({ app: { hold: 'Ctrl+H' } }).app.mode, 'hold');
  assert.equal(Model.normalise({ app: { toggle: 'Ctrl+T', hold: 'Ctrl+H' } }).app.mode, 'toggle');
});

test('the old Alt+click owner migrates to after-pick', () => {
  const app = Model.normalise({ altClick: 'app', app: { toggle: '', hold: '' } });
  assert.equal(app.app.mode, 'afterPick');

  const one = Model.normalise({
    altClick: 'palette:p1',
    app: { toggle: '', hold: '' },
    palettes: { p1: { toggle: '', hold: '' } },
  });
  assert.equal(one.app.mode, 'toggle');
  assert.equal(one.palettes.p1.mode, 'afterPick');

  const none = Model.normalise({ altClick: '', app: { toggle: '', hold: '' } });
  assert.equal(none.app.mode, 'toggle');
  assert.equal(Model.normalise({}).app.mode, 'toggle', 'new installs default to toggle');
});

test('an explicit after-pick flag wins over the legacy owner', () => {
  const s = Model.normalise({ altClick: 'app', app: { afterPick: false } });
  assert.equal(s.app.mode, 'toggle');
});

test('positions are validated', () => {
  assert.equal(Model.normalise({ app: { position: 'top-left' } }).app.position, 'top-left');
  assert.equal(Model.normalise({ app: { position: 'nonsense' } }).app.position, 'keep');
});

test('bindings contain only the selected mode', () => {
  const s = Model.normalise({
    app: { mode: 'toggle', toggle: 'Ctrl+1', hold: 'Ctrl+2' },
    palettes: {
      p1: { mode: 'hold', toggle: 'Ctrl+3', hold: 'Ctrl+4' },
      p2: { mode: 'afterPick', toggle: 'Ctrl+5', hold: 'Ctrl+6' },
    },
  });
  const list = Model.bindings(s, { 'i1:open': 'Ctrl+9' });
  assert.deepEqual(list.map((b) => b.key), [
    'app:toggle', 'palette:p1:hold', 'command:i1:open',
  ]);
  assert.equal(list[0].accel, 'Ctrl+1');
  assert.equal(list[1].accel, 'Ctrl+4');
});

test('a duplicate is found, except for the binding being replaced', () => {
  const s = Model.normalise({ app: { mode: 'toggle', toggle: 'Ctrl+1' } });
  assert.equal(Model.findConflict('Ctrl+1', s, {}, 'app:hold').key, 'app:toggle');
  assert.equal(Model.findConflict('Ctrl+1', s, {}, 'app:toggle'), null);
  assert.equal(Model.findConflict('Ctrl+9', s, {}, 'app:toggle'), null);
});

test('hold is allowed with Auto-hide either way', () => {
  assert.equal(Model.holdAllowed(false), true);
  assert.equal(Model.holdAllowed(true), true);
});

test('prune drops shortcuts for missing palettes', () => {
  const raw = {
    app: { mode: 'afterPick' },
    palettes: { gone: { toggle: 'Ctrl+1', hold: '' }, live: { toggle: 'Ctrl+2', hold: '' } },
  };
  const out = Model.prune(raw, ['live']);
  assert.equal(out.changed, true);
  assert.deepEqual(Object.keys(out.shortcuts.palettes), ['live']);
  assert.equal(out.shortcuts.app.mode, 'afterPick');
  assert.equal(Model.prune(out.shortcuts, ['live']).changed, false);
});

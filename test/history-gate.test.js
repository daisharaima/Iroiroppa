'use strict';

// The drawing-only gate routes picks to `note` (pending) while ON and to the
// normal settle/commit paths while OFF. It is the only place that decides, so
// every window is subject to the same rule (docs/INVARIANTS.md).

const test = require('node:test');
const assert = require('node:assert');
const { createHistoryGate } = require('../src/main/history-gate');

const rgb = (r, g, b) => ({ r, g, b });

function makeGate(on = false) {
  let enabled = on;
  const calls = [];
  const recorder = {
    note: (c) => calls.push(['note', c]),
    observe: (c) => calls.push(['observe', c]),
    commit: (c) => calls.push(['commit', c]),
    cancel: () => calls.push(['cancel']),
  };
  const gate = createHistoryGate({
    isOn: () => enabled,
    recorder,
    currentRgb: () => rgb(9, 9, 9),
    resync: () => calls.push(['resync']),
  });
  return { gate, calls, setOn: (v) => { enabled = v; } };
}

test('gate off: picks use the settle and explicit picks commit', () => {
  const { gate, calls } = makeGate(false);
  gate.onPick(rgb(1, 2, 3));
  gate.onExplicit(rgb(4, 5, 6));
  let up = 0;
  gate.onUp(() => { up += 1; });
  assert.deepEqual(calls, [['observe', rgb(1, 2, 3)], ['commit', rgb(4, 5, 6)]]);
  assert.equal(up, 1);
});

test('gate on: picks are only noted; the up path and adds are skipped', () => {
  const { gate, calls } = makeGate(true);
  gate.onPick(rgb(1, 2, 3));
  const recorded = gate.onExplicit(rgb(4, 5, 6));
  let up = 0;
  gate.onUp(() => { up += 1; });
  assert.deepEqual(calls, [
    ['note', rgb(1, 2, 3)],
    ['note', rgb(4, 5, 6)],
    ['resync'],
  ]);
  assert.equal(recorded, false, 'nothing entered the list');
  assert.equal(up, 0);
});

test('turning the gate on cancels and seeds the current colour', () => {
  const { gate, calls, setOn } = makeGate(false);
  setOn(true);
  gate.onToggle();
  assert.deepEqual(calls, [['cancel'], ['note', rgb(9, 9, 9)]]);
});

test('turning the gate off only cancels', () => {
  const { gate, calls, setOn } = makeGate(true);
  setOn(false);
  gate.onToggle();
  assert.deepEqual(calls, [['cancel']]);
});

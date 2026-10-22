'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { moduleUsage } = require('../src/shared/module-usage');

const doc = {
  columns: [{ modules: [{ instanceId: 'i1', moduleId: 'slider' }, { instanceId: 'i2', moduleId: 'stat' }] }],
  floats: [{ columns: [{ modules: [{ instanceId: 'i3', moduleId: 'slider' }] }] }],
  hiddenInstances: [{ instanceId: 'h1', moduleId: 'slider' }, { instanceId: 'h2', moduleId: 'wheel' }],
};

test('counts visible instances across the palette and floats', () => {
  assert.deepEqual(moduleUsage('slider', doc), { visible: 2, hidden: 1, total: 3, enabled: true });
  assert.deepEqual(moduleUsage('stat', doc), { visible: 1, hidden: 0, total: 1, enabled: true });
});

test('all hidden is not enabled', () => {
  const hiddenOnly = { columns: [], floats: [], hiddenInstances: [{ instanceId: 'h1', moduleId: 'slider' }] };
  assert.deepEqual(moduleUsage('slider', hiddenOnly), { visible: 0, hidden: 1, total: 1, enabled: false });
});

test('a module never placed is empty', () => {
  assert.deepEqual(moduleUsage('missing', doc), { visible: 0, hidden: 0, total: 0, enabled: false });
  assert.deepEqual(moduleUsage('missing'), { visible: 0, hidden: 0, total: 0, enabled: false });
});

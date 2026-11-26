'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = path.join(__dirname, '..', 'src', 'renderer', 'kernel', 'editable-fields.js');

function loadPage() {
  const listeners = new Map();
  const page = {
    window: {},
    document: {
      addEventListener: (type, fn) => { listeners.set(type, fn); },
      activeElement: null,
    },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(fs.readFileSync(SOURCE, 'utf8'), page);
  return { page, listeners };
}

test('a wired field asks the page for the bit it was given', () => {
  const { page, listeners } = loadPage();
  const seen = [];
  page.window.Iro.wireEditableFields({ setEditable: (on) => seen.push(on) });

  const field = { focus: () => {}, closest: () => field };
  listeners.get('pointerdown')({ target: field });

  assert.deepEqual(seen, [true]);
});

test('wiring without an action throws instead of falling back to a palette channel', () => {
  const { page } = loadPage();
  assert.throws(() => page.window.Iro.wireEditableFields(), /setEditable/);
});
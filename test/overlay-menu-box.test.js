'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { menuBox, ROW_H } = require('../src/main/overlay-menu-box');

const area = { x: 0, y: 0, width: 1920, height: 1080 };
const items = (n) => Array.from({ length: n }, (_, i) => ({ label: `Profile ${i}` }));

test('a short menu sizes to its rows', () => {
  const box = menuBox({ items: items(4), anchor: { x: 100, y: 100 }, area });
  assert.equal(box.height, 4 * ROW_H + 8 + 2 + 3);
  assert.equal(box.visibleRows, 4);
  assert.equal(box.scrolls, false);
});

test('an invalid anchor never produces a non-finite box', () => {
  for (const anchor of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: -Infinity, y: -Infinity }]) {
    const box = menuBox({ items: items(4), anchor, area });
    assert.ok(Number.isFinite(box.x));
    assert.ok(Number.isFinite(box.y));
    assert.ok(Number.isFinite(box.width));
    assert.ok(Number.isFinite(box.height));
  }
});

test('a long menu shows ten rows and scrolls', () => {
  const box = menuBox({ items: items(200), anchor: { x: 1870, y: 546 }, area: { x: 0, y: 0, width: 3840, height: 1552 } });
  assert.equal(box.visibleRows, 10);
  assert.equal(box.height, 10 * ROW_H + 8 + 2 + 9);
  assert.equal(box.scrolls, true);
  assert.ok(box.x + box.width <= 3840);
  assert.ok(box.y + box.height <= 1552);
});

test('the box stays inside the work area at every corner', () => {
  for (const anchor of [{ x: 0, y: 0 }, { x: 1920, y: 1080 }, { x: 1919, y: 0 }, { x: 0, y: 1079 }]) {
    const box = menuBox({ items: items(200), anchor, area });
    assert.ok(box.x >= area.x, 'x left');
    assert.ok(box.y >= area.y, 'y top');
    assert.ok(box.x + box.width <= area.x + area.width, 'x right');
    assert.ok(box.y + box.height <= area.y + area.height, 'y bottom');
  }
});

test('the row cap respects a small screen', () => {
  const box = menuBox({ items: items(200), anchor: { x: 10, y: 10 }, area: { x: 0, y: 0, width: 640, height: 300 } });
  assert.ok(box.height <= Math.round(300 * 0.7));
  assert.equal(box.scrolls, true);
});

test('a wide label widens the menu, up to the cap', () => {
  const wide = menuBox({ items: [{ label: 'x'.repeat(200) }], anchor: { x: 10, y: 10 }, area });
  assert.equal(wide.width, 360);
});

test('an action row and a separator do not become profile rows', () => {
  const items = [
    { label: 'Browse for ICC profile…', kind: 'action' },
    { kind: 'separator' },
    { label: 'Default sRGB' },
    { label: 'Adobe RGB (1998)' },
  ];
  const box = menuBox({ items, anchor: { x: 100, y: 100 }, area: { x: 0, y: 0, width: 1000, height: 900 } });
  assert.ok(box.height > 3 * ROW_H, 'the action row adds height beyond three normal rows');
  assert.ok(box.height <= 4 * ROW_H);
  assert.equal(box.visibleRows, 3, 'the separator is not counted as a visible row');
});

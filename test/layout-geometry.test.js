'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const G = require('../src/shared/layout-geometry');

const OPT = {
  pad: 12,
  divider: 13,
  gap: 14,
  minColumn: 10,
  minModule: 11,
  defaultColumnWidth: 260,
  defaultModuleHeight: 60,
  minPalette: { width: 200, height: 340 },
  chrome: { width: 0, height: 0 },
};

const m = (instanceId, height) => ({ instanceId, moduleId: 'x', height });
const sum = (list) => list.reduce((total, n) => total + n, 0);

// --- columns ---------------------------------------------------------------

test('a null-width column fills the board', () => {
  const [only] = G.columnWidths([{ id: 'c1', width: null }], 300, OPT);
  assert.equal(only.width, 276);
  assert.equal(only.fill, true);
});

test('a single column fills the board whatever width it stored', () => {
  const [only] = G.columnWidths([{ id: 'c1', width: 133 }], 200, OPT);
  assert.equal(only.width, 176);
  assert.equal(only.fill, true);
});

test('two null widths share the space exactly', () => {
  const out = G.columnWidths([{ id: 'a', width: null }, { id: 'b', width: null }], 300, OPT);
  assert.equal(sum(out.map((c) => c.width)), 263);
  assert.ok(Math.abs(out[0].width - out[1].width) <= 1);
});

test('an explicit width is kept and the rest fills', () => {
  const out = G.columnWidths([{ id: 'a', width: 200 }, { id: 'b', width: null }], 500, OPT);
  assert.equal(out[0].width, 200);
  assert.equal(out[1].width, 263);
  assert.equal(out[1].fill, true);
});

test('over-full columns are scaled back inside the board', () => {
  const out = G.columnWidths([{ id: 'a', width: 700 }, { id: 'b', width: 700 }], 300, OPT);
  assert.ok(sum(out.map((c) => c.width)) <= 300);
});

// --- modules ---------------------------------------------------------------

test('leftover height goes to the fill module', () => {
  const column = { id: 'c', width: null, modules: [m('a', { mode: 'auto' }), m('b', { mode: 'fill', weight: 1 })] };
  const rects = G.moduleRects(column, 300, { a: 100 }, OPT);
  assert.deepEqual(rects.map((r) => r.height), [100, 186]);
  assert.equal(rects[0].top, 0);
  assert.equal(rects[1].top, 114);
});

test('with no fill module the last one absorbs the leftover', () => {
  const column = { modules: [m('a', { mode: 'auto' }), m('b', { mode: 'auto' })] };
  const rects = G.moduleRects(column, 300, { a: 100, b: 60 }, OPT);
  assert.deepEqual(rects.map((r) => r.height), [100, 186]);
  assert.equal(rects[0].height + rects[1].height + OPT.gap, 300);
});

test('a lone module fills its column', () => {
  const rects = G.moduleRects({ modules: [m('a', { mode: 'auto' })] }, 250, { a: 40 }, OPT);
  assert.equal(rects[0].height, 250);
});

test('a px height is exact, and fill modules share by weight', () => {
  const mixed = { modules: [m('a', { mode: 'px', px: 80 }), m('b', { mode: 'fill', weight: 1 })] };
  assert.deepEqual(G.moduleRects(mixed, 300, {}, OPT).map((r) => r.height), [80, 206]);

  const twoFills = { modules: [m('a', { mode: 'fill', weight: 1 }), m('b', { mode: 'fill', weight: 3 })] };
  const out = G.moduleRects(twoFills, 300, {}, OPT);
  assert.equal(sum(out.map((r) => r.height)) + OPT.gap, 300);
  assert.ok(out[1].height > out[0].height * 2.5);
});

test('a column never leaves empty space, whatever it holds', () => {
  const cases = [
    { modules: [m('a', { mode: 'auto' }), m('b', { mode: 'fill', weight: 2 }), m('c', { mode: 'px', px: 40 })], measured: { a: 90 } },
    { modules: [m('a', { mode: 'px', px: 30 }), m('b', { mode: 'px', px: 30 })], measured: {} },
    { modules: [m('a', { mode: 'auto' })], measured: { a: 12 } },
  ];
  for (const item of cases) {
    const rects = G.moduleRects({ modules: item.modules }, 420, item.measured, OPT);
    const used = sum(rects.map((r) => r.height)) + OPT.gap * (item.modules.length - 1);
    assert.equal(used, 420, `filled: ${JSON.stringify(item.modules.map((x) => x.height))}`);
  }
});

// --- palette size ----------------------------------------------------------

test('a palette of single auto columns shrink-wraps to its content', () => {
  const palette = { size: { width: 1, height: 1 }, columns: [{ id: 'c', width: null, modules: [m('a', { mode: 'auto' })] }] };
  assert.equal(G.isContentFit(palette), true);
  const size = G.contentSize(palette, { a: 180 }, OPT);
  assert.equal(size.width, 284);
  assert.equal(size.height, 204);
  assert.equal(G.isContentFit({ columns: [{ modules: [m('a', { mode: 'auto' }), m('b', { mode: 'auto' })] }] }), false);
});

test('minSize sums a column and takes the tallest', () => {
  const palette = {
    size: { width: 300, height: 600 },
    columns: [
      { id: 'c1', width: 250, modules: [m('a', { mode: 'fill', weight: 1 })] },
      { id: 'c2', width: null, modules: [m('b', { mode: 'auto' }), m('c', { mode: 'auto' })] },
    ],
  };
  const mins = { a: { width: 120, height: 90 }, b: { width: 180, height: 200 }, c: { width: 100, height: 150 } };
  const min = G.minSize(palette, mins, OPT);
  assert.equal(min.height, 388);
  assert.equal(min.width, 547);
});

test('minSize never goes below the palette floor', () => {
  const palette = { size: { width: 10, height: 10 }, columns: [{ id: 'c', width: null, modules: [m('a', { mode: 'auto' })] }] };
  assert.deepEqual(G.minSize(palette, { a: { width: 20, height: 20 } }, OPT), { width: 284, height: 340 });
});

test('growing rules', () => {
  const palette = { size: { width: 300, height: 600 }, columns: [{ id: 'c', width: null, modules: [m('a', { mode: 'auto' })] }] };
  assert.deepEqual(G.grownSize(palette, { kind: 'grow' }, { a: 100 }, {}, OPT), { width: 300, height: 600 });
  assert.deepEqual(G.grownSize(palette, { kind: 'columns-added', px: 260 }, { a: 100 }, {}, OPT), { width: 560, height: 600 });
  assert.deepEqual(G.grownSize(palette, { kind: 'content' }, { a: 900 }, {}, OPT), { width: 300, height: 924 });

  const tiny = { size: { width: 300, height: 100 }, columns: [{ id: 'c', width: null, modules: [m('a', { mode: 'auto' })] }] };
  assert.deepEqual(G.grownSize(tiny, { kind: 'grow' }, { a: 100 }, {}, OPT), { width: 300, height: 340 });
  assert.deepEqual(G.grownSize(tiny, { kind: 'content-fit' }, { a: 500 }, {}, OPT), { width: 284, height: 524 });
});

test('paletteRects lays the whole board out', () => {
  const palette = {
    size: { width: 300, height: 400 },
    columns: [{ id: 'c1', width: null, modules: [m('a', { mode: 'auto' }), m('b', { mode: 'fill', weight: 1 })] }],
  };
  const [column] = G.paletteRects(palette, { a: 100 }, OPT);
  assert.equal(column.width, 276);
  assert.deepEqual(column.modules.map((r) => r.height), [100, 262]);
  assert.equal(column.modules[0].height + column.modules[1].height + OPT.gap, 376, 'the board height is filled');
});

test('chrome is added to the palette size but kept out of the board', () => {
  const withChrome = { ...OPT, chrome: { width: 0, height: 40 } };
  const palette = { size: { width: 300, height: 400 }, columns: [{ id: 'c', width: null, modules: [m('a', { mode: 'fill', weight: 1 })] }] };
  assert.deepEqual(G.boardBox(palette, withChrome), { width: 300, height: 360 });
  assert.equal(G.moduleRects(palette.columns[0], G.boardBox(palette, withChrome).height - OPT.pad * 2, {}, withChrome)[0].height, 336);
  assert.equal(G.minSize(palette, { a: { width: 10, height: 20 } }, withChrome).height, 340, 'the floor still applies');
});

// --- snap groups -----------------------------------------------------------

const rect = (x, y, width, height) => ({ x, y, width, height });

test('snapFlush puts a follower on any of the four anchor edges', () => {
  const anchor = rect(0, 0, 300, 600);
  assert.deepEqual(G.snapFlush(anchor, rect(320, 50, 260, 600), 'right'), rect(300, 50, 260, 600));
  assert.deepEqual(G.snapFlush(anchor, rect(20, 50, 260, 600), 'left'), rect(-260, 50, 260, 600));
  assert.deepEqual(G.snapFlush(anchor, rect(20, 620, 300, 400), 'bottom'), rect(20, 600, 300, 400));
  assert.deepEqual(G.snapFlush(anchor, rect(20, -420, 300, 400), 'top'), rect(20, -400, 300, 400));
});

test('resizing the follower shared edge grows the anchor and keeps the outer edge', () => {
  const out = G.reflowSnapResize({
    side: 'right',
    resizedRole: 'follower',
    prevAnchor: rect(0, 0, 300, 600), anchor: rect(0, 0, 300, 600),
    prevFollower: rect(300, 0, 260, 600), follower: rect(330, 0, 230, 600),
  });
  assert.equal(out.changed, true);
  assert.deepEqual(out.anchor, rect(0, 0, 330, 600));
  assert.deepEqual(out.follower, rect(330, 0, 230, 600));
  assert.equal(out.follower.x + out.follower.width, 560, 'the follower outer edge is fixed');
});

test('resizing a follower outer edge leaves the anchor alone', () => {
  const out = G.reflowSnapResize({
    side: 'right',
    resizedRole: 'follower',
    prevAnchor: rect(0, 0, 300, 600), anchor: rect(0, 0, 300, 600),
    prevFollower: rect(300, 0, 260, 600), follower: rect(300, 0, 300, 600),
  });
  assert.equal(out.changed, false);
  assert.deepEqual(out.anchor, rect(0, 0, 300, 600));
});

test('resizing the anchor shared edge resizes the follower and keeps its outer edge', () => {
  const out = G.reflowSnapResize({
    side: 'right',
    resizedRole: 'anchor',
    prevAnchor: rect(0, 0, 300, 600), anchor: rect(0, 0, 340, 600),
    prevFollower: rect(300, 0, 260, 600), follower: rect(300, 0, 260, 600),
  });
  assert.equal(out.changed, true);
  assert.deepEqual(out.anchor, rect(0, 0, 340, 600));
  assert.deepEqual(out.follower, rect(340, 0, 220, 600));
  assert.equal(out.follower.x + out.follower.width, 560, 'the follower outer edge is fixed');
});

test('resizing an anchor outer edge leaves the follower alone', () => {
  const out = G.reflowSnapResize({
    side: 'right',
    resizedRole: 'anchor',
    prevAnchor: rect(0, 0, 300, 600), anchor: rect(-40, 0, 340, 600),
    prevFollower: rect(300, 0, 260, 600), follower: rect(300, 0, 260, 600),
  });
  assert.equal(out.changed, false);
});

test('a minimum clamps the splitter and pulls the resized window back', () => {
  // The follower's left edge is dragged to 180; the anchor may not go below 200.
  const follower = G.reflowSnapResize({
    side: 'right',
    resizedRole: 'follower',
    prevAnchor: rect(0, 0, 300, 600), anchor: rect(0, 0, 300, 600),
    prevFollower: rect(300, 0, 260, 600), follower: rect(180, 0, 380, 600),
    minAnchor: 200,
  });
  assert.equal(follower.changed, true);
  assert.deepEqual(follower.anchor, rect(0, 0, 200, 600));
  assert.deepEqual(follower.follower, rect(200, 0, 360, 600));
  assert.equal(follower.follower.x, follower.anchor.x + follower.anchor.width, 'still flush');

  // The anchor's right edge is dragged in; the follower may not go below 320.
  const anchor = G.reflowSnapResize({
    side: 'right',
    resizedRole: 'anchor',
    prevAnchor: rect(0, 0, 300, 600), anchor: rect(0, 0, 260, 600),
    prevFollower: rect(300, 0, 260, 600), follower: rect(300, 0, 260, 600),
    minFollower: 320,
  });
  assert.equal(anchor.changed, true);
  assert.deepEqual(anchor.follower, rect(240, 0, 320, 600));
  assert.deepEqual(anchor.anchor, rect(0, 0, 240, 600));
  assert.equal(anchor.follower.x, anchor.anchor.x + anchor.anchor.width, 'still flush');
});

test('the left, top and bottom sides reflow too', () => {
  const left = G.reflowSnapResize({
    side: 'left',
    resizedRole: 'follower',
    prevAnchor: rect(300, 0, 300, 600), anchor: rect(300, 0, 300, 600),
    prevFollower: rect(0, 0, 300, 600), follower: rect(0, 0, 330, 600),
  });
  assert.deepEqual(left.anchor, rect(330, 0, 270, 600));
  assert.deepEqual(left.follower, rect(0, 0, 330, 600));

  const bottom = G.reflowSnapResize({
    side: 'bottom',
    resizedRole: 'follower',
    prevAnchor: rect(0, 0, 300, 600), anchor: rect(0, 0, 300, 600),
    prevFollower: rect(0, 600, 300, 400), follower: rect(0, 620, 300, 380),
  });
  assert.deepEqual(bottom.anchor, rect(0, 0, 300, 620));
  assert.deepEqual(bottom.follower, rect(0, 620, 300, 380));

  const top = G.reflowSnapResize({
    side: 'top',
    resizedRole: 'follower',
    prevAnchor: rect(0, 600, 300, 400), anchor: rect(0, 600, 300, 400),
    prevFollower: rect(0, 0, 300, 600), follower: rect(0, 0, 300, 570),
  });
  assert.deepEqual(top.anchor, rect(0, 570, 300, 430));
  assert.deepEqual(top.follower, rect(0, 0, 300, 570));
});

test('keepSharedEdge pins the edge a snapped window must not move', () => {
  const prev = rect(0, 0, 300, 600);
  const next = rect(0, 0, 300, 500);
  assert.deepEqual(G.keepSharedEdge(prev, next, 'bottom'), rect(0, 100, 300, 500));
  assert.deepEqual(G.keepSharedEdge(prev, next, 'top'), rect(0, 0, 300, 500));
  const wide = rect(0, 0, 320, 600);
  assert.deepEqual(G.keepSharedEdge(prev, wide, 'right'), rect(-20, 0, 320, 600));
  assert.deepEqual(G.keepSharedEdge(prev, wide, 'left'), rect(0, 0, 320, 600));
});

test('relayoutFollowers moves the whole group flush after a move', () => {
  const out = G.relayoutFollowers(rect(100, 100, 300, 600), [
    { side: 'right', rect: rect(320, 50, 260, 600) },
    { side: 'top', rect: rect(0, -200, 300, 300) },
  ]);
  assert.deepEqual(out[0].rect, rect(400, 50, 260, 600));
  assert.deepEqual(out[1].rect, rect(0, -200, 300, 300));
});

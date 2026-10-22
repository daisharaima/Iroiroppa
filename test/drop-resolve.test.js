'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Drop = require('../src/shared/drop-resolve');

// A pane 300x640 at (300, 100), zoom 1: two columns, c1 (fills: 194) with an
// auto module (200) over a fill module (434), then a 2 px divider, then c2
// (100) with one fill module (634). Board padding is 2.
const PANE = {
  paletteId: 'p1',
  rect: { x: 300, y: 100, width: 300, height: 640 },
  zoom: 1,
  measured: { m1: 200 },
  columns: [
    { id: 'c1', width: null, modules: [{ instanceId: 'm1', height: { mode: 'auto' } }, { instanceId: 'm2', height: { mode: 'fill', weight: 1 } }] },
    { id: 'c2', width: 100, modules: [{ instanceId: 'm3', height: { mode: 'fill', weight: 1 } }] },
  ],
};
const at = (lx, ly, pane = PANE) => ({ point: { x: pane.rect.x + lx, y: pane.rect.y + ly }, panes: [pane] });

test('a point outside every pane is the desktop', () => {
  const plan = Drop.resolveDrop(at(500, 500)); // local x is past the pane's width
  assert.equal(plan.kind, 'desktop');
  assert.equal(plan.line, null);
});

test('a drop in the edge band still lands in the column, never a new one', () => {
  // One column per palette: the old outer-edge target (a second column) is gone, so
  // the edge band resolves to the column under the pointer with a horizontal line.
  const left = Drop.resolveDrop(at(20, 400));
  assert.equal(left.kind, 'column');
  assert.equal(left.columnId, 'c1');
  assert.equal(left.index, 1); // y=400 is past m1's midpoint (102), before m2's (421)
  assert.equal(left.line.axis, 'h');

  const right = Drop.resolveDrop(at(280, 400));
  assert.equal(right.kind, 'column');
  assert.equal(right.columnId, 'c2');
});

test('the divider band resolves to a column too (there is no seam target)', () => {
  const plan = Drop.resolveDrop(at(197, 400)); // c1 ends at 196, c2 starts at 198
  assert.equal(plan.kind, 'column');
  assert.equal(plan.line.axis, 'h');
});

test('inside a column the index follows the module midpoints', () => {
  const above = Drop.resolveDrop(at(90, 50)); // m1 middle is 102
  assert.equal(above.kind, 'column');
  assert.equal(above.columnId, 'c1');
  assert.equal(above.index, 0);
  assert.equal(above.line.y, 2); // the column's inner top

  const between = Drop.resolveDrop(at(90, 210)); // m1 2..202, m2 204..638
  assert.equal(between.index, 1);
  assert.equal(between.line.y, 203); // midway across the 2 px gap

  const below = Drop.resolveDrop(at(90, 600));
  assert.equal(below.index, 2);
  assert.equal(below.line.y, 638); // the last module's bottom, not past it
});

test('the right-hand column resolves on its own', () => {
  const plan = Drop.resolveDrop(at(220, 300));
  assert.equal(plan.columnId, 'c2');
  assert.equal(plan.index, 0);
  assert.equal(plan.line.x, 198); // c2 starts after the divider
  assert.equal(plan.line.length, 100);
});

test('an empty palette is a drop zone in its one column', () => {
  const empty = {
    paletteId: 'p2',
    rect: { x: 0, y: 0, width: 300, height: 640 },
    zoom: 1,
    columns: [{ id: 'c9', width: null, modules: [] }],
  };
  const plan = Drop.resolveDrop({ point: { x: 150, y: 300 }, panes: [empty] });
  assert.equal(plan.kind, 'column');
  assert.equal(plan.paletteId, 'p2');
  assert.equal(plan.columnId, 'c9');
  assert.equal(plan.index, 0);
});

test('the point is converted with the pane zoom, so a scaled window resolves the same', () => {
  const scaled = {
    paletteId: 'p3',
    rect: { x: 1000, y: 500, width: 400, height: 800 }, // a 200x400 CSS pane at zoom 2
    zoom: 2,
    measured: { m1: 200 },
    columns: [
      { id: 'c1', width: null, modules: [{ instanceId: 'm1', height: { mode: 'auto' } }, { instanceId: 'm2', height: { mode: 'fill', weight: 1 } }] },
    ],
  };
  // Local (100, 50) -> screen (1000 + 200, 500 + 100).
  const plan = Drop.resolveDrop({ point: { x: 1200, y: 600 }, panes: [scaled] });
  assert.equal(plan.kind, 'column');
  assert.equal(plan.index, 0);
  assert.equal(plan.line.x, 2); // local CSS px, not DIP
  assert.equal(plan.line.y, 2);
});

test('the pane order decides which window is on top when two overlap', () => {
  const under = { paletteId: 'under', rect: { x: 0, y: 0, width: 300, height: 640 }, zoom: 1, columns: [] };
  const over = { paletteId: 'over', rect: { x: 0, y: 0, width: 300, height: 640 }, zoom: 1, columns: [] };
  const point = { x: 150, y: 300 };
  assert.equal(Drop.resolveDrop({ point, panes: [over, under] }).paletteId, 'over');
  assert.equal(Drop.resolveDrop({ point, panes: [under, over] }).paletteId, 'under');
});

test('a plan maps onto the reducer target it will be dispatched as', () => {
  assert.deepEqual(Drop.toPlaceTarget(Drop.resolveDrop(at(90, 50))), {
    kind: 'column', paletteId: 'p1', columnId: 'c1', index: 0,
  });
  // A drop on the divider band is a column insert now, not a seam.
  assert.deepEqual(Drop.toPlaceTarget(Drop.resolveDrop(at(220, 300))), {
    kind: 'column', paletteId: 'p1', columnId: 'c2', index: 0,
  });
  assert.deepEqual(Drop.toPlaceTarget(Drop.resolveDrop(at(500, 500))), { kind: 'desktop' });
});

test('reported boxes win over the document, because that is what the board drew', () => {
  const boxed = {
    paletteId: 'p9',
    rect: { x: 0, y: 0, width: 300, height: 640 },
    zoom: 1,
    // Nothing like what geometry would compute from `columns` — deliberately.
    boxes: { columns: [{ columnId: 'cX', left: 100, width: 180, modules: [{ instanceId: 'mX', top: 20, height: 300 }] }] },
    columns: [{ id: 'c1', width: null, modules: [{ instanceId: 'm1', height: { mode: 'fill', weight: 1 } }] }],
  };
  const plan = Drop.resolveDrop({ point: { x: 150, y: 100 }, panes: [boxed] });
  assert.equal(plan.kind, 'column');
  assert.equal(plan.columnId, 'cX');
  assert.equal(plan.line.x, 100);
  assert.equal(plan.line.y, 20);
});

test('the boundaries come from the reported boxes too', () => {
  const boxed = {
    paletteId: 'p9',
    rect: { x: 0, y: 0, width: 340, height: 640 },
    zoom: 1,
    boxes: {
      columns: [
        { columnId: 'a', left: 12, width: 148, modules: [{ instanceId: 'a1', top: 12, height: 100 }, { instanceId: 'a2', top: 126, height: 200 }] },
        { columnId: 'b', left: 173, width: 127, modules: [] },
      ],
    },
  };
  // A point in the gap between the two drawn columns lands in the nearest one (the
  // right-hand column here), never a new column.
  const seam = Drop.resolveDrop({ point: { x: 166, y: 300 }, panes: [boxed] });
  assert.equal(seam.kind, 'column');
  assert.equal(seam.columnId, 'b');

  const first = Drop.resolveDrop({ point: { x: 60, y: 40 }, panes: [boxed] });
  assert.equal(first.index, 0);
  assert.equal(first.line.y, 12);

  const second = Drop.resolveDrop({ point: { x: 60, y: 120 }, panes: [boxed] });
  assert.equal(second.index, 1);
  assert.equal(second.line.y, 119); // midway between a1's bottom (112) and a2's top (126)
});

test('a pane with no columns at all is still a drop zone', () => {
  const empty = { paletteId: 'p2', rect: { x: 0, y: 0, width: 300, height: 640 }, zoom: 1, boxes: { columns: [] }, columns: [] };
  const plan = Drop.resolveDrop({ point: { x: 150, y: 300 }, panes: [empty] });
  assert.equal(plan.kind, 'column');
  assert.equal(plan.paletteId, 'p2');
});

test('nothing to resolve is null, not a throw', () => {
  assert.equal(Drop.resolveDrop(null), null);
  assert.equal(Drop.resolveDrop({}), null);
  assert.equal(Drop.resolveDrop({ point: { x: 1, y: 1 }, panes: [] }).kind, 'desktop');
});

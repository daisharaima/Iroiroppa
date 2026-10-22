'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDragSession } = require('../src/main/drag-session');

// One 300x640 pane at the origin: a 276 px column with an auto module (200) over
// a fill module (402), so local y decides the insertion index (0 above, 2 below).
const PANE = {
  paletteId: 'p1',
  rect: { x: 0, y: 0, width: 300, height: 640 },
  zoom: 1,
  measured: { m1: 200 },
  columns: [
    { id: 'c1', width: null, modules: [{ instanceId: 'm1', height: { mode: 'auto' } }, { instanceId: 'm2', height: { mode: 'fill', weight: 1 } }] },
  ],
};

function harness(overrides = {}) {
  let point = { x: 100, y: 50 };
  let clock = 0;
  let timer = null;
  const shown = [];
  const dispatched = [];
  const events = [];
  const session = createDragSession({
    now: () => clock,
    cursor: () => point,
    getPanes: () => [PANE],
    dispatch: (intent) => { dispatched.push(intent); return { ok: true, rev: 7 }; },
    show: (state) => shown.push(state),
    hide: () => events.push('hide'),
    setInterval: (fn) => { timer = fn; return { unref() {} }; },
    clearInterval: () => { timer = null; events.push('clear'); },
    ...overrides,
  });
  return {
    session, shown, dispatched, events,
    move: (p) => { point = p; },
    setTime: (v) => { clock = v; },
    tick: () => (timer ? timer() : null),
    ticking: () => Boolean(timer),
  };
}

test('a begin with nothing to drag is refused and leaves no timer', () => {
  const h = harness();
  assert.equal(h.session.begin({ items: [] }).ok, false);
  assert.equal(h.session.active(), false);
  assert.equal(h.ticking(), false);
});

test('begin starts the poll and paints the chip with a plan', () => {
  const h = harness();
  const out = h.session.begin({ sourcePaletteId: 'p1', items: ['m1'], text: 'OKLCH Slice' });
  assert.equal(out.ok, true);
  assert.equal(h.session.active(), true);
  assert.equal(h.ticking(), true);
  assert.equal(h.shown.length, 1);
  // The chip names what is being carried from the first tick, including while the pointer is still
  // inside the source palette: blanking it there (the old rule) made a drag look like the module had
  // vanished, which is what the user reported. The *card* stays visible until the pointer leaves —
  // that is the renderer's rule and a different question from what the chip says.
  assert.equal(h.shown[0].text, 'OKLCH Slice');
  assert.deepEqual([h.shown[0].x, h.shown[0].y], [100, 50]);
  assert.equal(h.shown[0].line.axis, 'h');
  // The caller needs to know which pane the line belongs to, to convert it.
  assert.equal(h.shown[0].paletteId, 'p1');
});

test('the chip appears once the pointer leaves the source palette', () => {
  const other = {
    paletteId: 'p2',
    rect: { x: 400, y: 0, width: 300, height: 640 },
    zoom: 1,
    columns: [{ id: 'd1', width: null, modules: [{ instanceId: 'm3', height: { mode: 'fill', weight: 1 } }] }],
  };
  const h = harness({ getPanes: () => [other, PANE] });
  h.move({ x: 500, y: 300 });
  h.session.begin({ sourcePaletteId: 'p1', items: ['m1'], text: 'OKLCH Slice' });
  assert.equal(h.shown[0].text, 'OKLCH Slice');
  assert.equal(h.shown[0].paletteId, 'p2');
});

test('a tick follows the cursor and re-resolves', () => {
  const h = harness();
  h.session.begin({ sourcePaletteId: 'p1', items: ['m1'] });
  h.move({ x: 100, y: 600 });
  const plan = h.tick();
  assert.equal(plan.kind, 'column');
  assert.equal(plan.index, 2);
  assert.equal(h.shown.length, 2);
  assert.equal(h.shown[1].y, 600);
});

test('drop dispatches the plan it drew and stops polling', () => {
  const h = harness();
  h.session.begin({ sourcePaletteId: 'p1', items: ['m1'] });
  h.tick();
  const out = h.session.drop();
  assert.equal(out.ok, true);
  assert.equal(h.dispatched.length, 1);
  const intent = h.dispatched[0];
  assert.equal(intent.type, 'layout.place');
  assert.equal(intent.sourcePaletteId, 'p1');
  assert.deepEqual(intent.items, ['m1']);
  assert.deepEqual(intent.target, { kind: 'column', paletteId: 'p1', columnId: 'c1', index: 0 });
  assert.equal(h.ticking(), false);
  assert.equal(h.events.includes('hide'), true);
  assert.equal(h.session.active(), false);
});

test('drop re-resolves at the drop point, not from the last tick', () => {
  const h = harness();
  h.session.begin({ sourcePaletteId: 'p1', items: ['m1'] });
  h.move({ x: 100, y: 50 });
  h.tick(); // plan says index 0
  h.move({ x: 100, y: 600 }); // the pointer moved, and no tick ran before the drop
  const out = h.session.drop();
  assert.equal(out.target.index, 2);
});

test('a drop outside every pane becomes a new window', () => {
  const h = harness();
  h.session.begin({ sourcePaletteId: 'p1', items: ['m1'], grouping: 'columns' });
  h.move({ x: 900, y: 900 });
  const out = h.session.drop();
  // A new window is dropped *where the pointer is* (screen DIP), not left to main's
  // "just right of the palette" fallback.
  assert.deepEqual(out.target, { kind: 'desktop', pos: { x: 900, y: 900 } });
  assert.equal(h.dispatched[0].grouping, 'columns');
});

test('cancel leaves the document alone', () => {
  const h = harness();
  h.session.begin({ sourcePaletteId: 'p1', items: ['m1'] });
  assert.equal(h.session.cancel(), true);
  assert.equal(h.dispatched.length, 0);
  assert.equal(h.ticking(), false);
  assert.equal(h.session.cancel(), false); // nothing to cancel
});

test('a drag that never ends cancels itself instead of polling forever', () => {
  const h = harness({ maxMs: 1000 });
  h.session.begin({ sourcePaletteId: 'p1', items: ['m1'] });
  h.setTime(1001);
  assert.equal(h.tick(), null);
  assert.equal(h.session.active(), false);
  assert.equal(h.dispatched.length, 0);
  assert.equal(h.ticking(), false);
});

test('a second begin supersedes the first', () => {
  const h = harness();
  h.session.begin({ sourcePaletteId: 'p1', items: ['m1'] });
  h.session.begin({ sourcePaletteId: 'p1', items: ['m2'] });
  const state = h.session.state();
  assert.deepEqual(state.payload.items, ['m2']);
  assert.equal(h.dispatched.length, 0);
  assert.equal(h.events.filter((e) => e === 'hide').length, 1); // the first was stopped
});

test('drop without a drag, and a refused dispatch, are both reported', () => {
  const h = harness();
  assert.deepEqual(h.session.drop(), { ok: false, error: 'no-drag' });
  const refusing = harness({ dispatch: () => ({ ok: false, error: 'noop' }) });
  refusing.session.begin({ sourcePaletteId: 'p1', items: ['m1'] });
  const out = refusing.session.drop();
  assert.equal(out.ok, false);
  assert.equal(out.error, 'noop', 'a refused dispatch reports why');
  assert.equal(refusing.session.active(), false, 'a refused drop still ends the drag');
});

test('the session needs its collaborators', () => {
  assert.throws(() => createDragSession({}), /cursor, getPanes and dispatch/);
});

test('a drag nobody is holding ends itself instead of polling forever', () => {
  // A `pointerup` can be lost — the OS can take a drag over (PowerToys FancyZones does it
  // when Shift is held) — so a session that only ends on a message would poll forever with
  // the chip and indicator stuck on screen.
  const h = harness();
  h.session.begin({ items: ['m1'], sourcePaletteId: 'p1' });
  h.tick();
  assert.equal(h.session.active(), true);
  h.setTime(1000);
  h.tick();
  assert.equal(h.session.active(), true, 'still inside the stall window');
  h.setTime(3000);
  h.tick();
  assert.equal(h.session.active(), false, 'a stationary cursor gives up');
  assert.ok(h.events.includes('hide'), 'and the overlay is hidden');
});

test('a drag that keeps moving is never stopped by the stall watchdog', () => {
  const h = harness();
  h.session.begin({ items: ['m1'], sourcePaletteId: 'p1' });
  for (let i = 0; i < 10; i += 1) {
    h.setTime(i * 2400);
    h.move({ x: 100 + i, y: 50 });
    h.tick();
  }
  assert.equal(h.session.active(), true);
});

test('every end reports it, so main can clear what the drag left behind', () => {
  const ends = [];
  const h = harness({ onEnd: () => ends.push('end') });
  h.session.begin({ items: ['m1'], sourcePaletteId: 'p1' });
  h.session.drop();
  assert.deepEqual(ends, ['end']);
});

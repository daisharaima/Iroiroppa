'use strict';

// The interaction hub's state machine (E1). Pure: no Electron, no clock tricks —
// `now` is injected so a test can be deterministic.

const test = require('node:test');
const assert = require('node:assert');
const { createInteractionHub } = require('../src/main/interaction');

const D = 'color';

test('begin/update/end on the happy path', () => {
  const hub = createInteractionHub();
  const b = hub.begin({ id: 'i1', domain: D, windowId: 7, baseRev: 3, currentRev: 3 });
  assert.equal(b.ok, true);
  assert.equal(b.rejected, null);
  assert.equal(hub.update({ id: 'i1', domain: D, seq: 1, value: { r: 1, g: 2, b: 3 } }).ok, true);
  assert.equal(hub.update({ id: 'i1', domain: D, seq: 2, value: { r: 4, g: 5, b: 6 } }).ok, true);
  const e = hub.end({ id: 'i1', domain: D, seq: 2, value: { r: 4, g: 5, b: 6 } });
  assert.equal(e.ok, true);
  assert.equal(e.commit, true);
  assert.deepEqual(e.value, { r: 4, g: 5, b: 6 });
  assert.equal(hub.get(D), null);
});

test('a stale base revision is refused and leaves nothing active', () => {
  const hub = createInteractionHub();
  const b = hub.begin({ id: 'i1', domain: D, windowId: 7, baseRev: 2, currentRev: 5 });
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'stale-base');
  assert.equal(hub.get(D), null);
});

test('a second begin supersedes the first and the owner is told', () => {
  const hub = createInteractionHub();
  hub.begin({ id: 'i1', domain: D, windowId: 7, baseRev: 1, currentRev: 1 });
  const b = hub.begin({ id: 'i2', domain: D, windowId: 9, baseRev: 1, currentRev: 1 });
  assert.equal(b.ok, true);
  assert.deepEqual(b.rejected, { interactionId: 'i1', windowId: 7, reason: 'superseded' });
  assert.equal(hub.owns(D, 9), true);
  assert.equal(hub.owns(D, 7), false);
  assert.equal(hub.update({ id: 'i1', domain: D, seq: 1, value: {} }).ok, false, 'the displaced owner cannot update');
});

test('updates are ordered: a late or duplicate seq is dropped', () => {
  const hub = createInteractionHub();
  hub.begin({ id: 'i1', domain: D, windowId: 7, baseRev: 0, currentRev: 0 });
  assert.equal(hub.update({ id: 'i1', domain: D, seq: 4, value: {} }).ok, true);
  assert.deepEqual(hub.update({ id: 'i1', domain: D, seq: 4, value: {} }), { ok: false, drop: true, reason: 'stale-seq' });
  assert.deepEqual(hub.update({ id: 'i1', domain: D, seq: 3, value: {} }), { ok: false, drop: true, reason: 'stale-seq' });
  assert.equal(hub.update({ id: 'i1', domain: D, seq: 5, value: {} }).ok, true);
});

test('an update from a window that does not own the interaction is dropped', () => {
  const hub = createInteractionHub();
  hub.begin({ id: 'i1', domain: D, windowId: 7, baseRev: 0, currentRev: 0 });
  const r = hub.update({ id: 'i9', domain: D, seq: 1, value: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-active');
});

test('invalidate ends the interaction, moves the epoch and names the owner', () => {
  const hub = createInteractionHub();
  hub.begin({ id: 'i1', domain: D, windowId: 7, baseRev: 0, currentRev: 0 });
  const epochBefore = hub.epochOf(D);
  hub.update({ id: 'i1', domain: D, seq: 2, value: { r: 1, g: 1, b: 1 } });
  const gone = hub.invalidate(D, 'invalidated');
  assert.deepEqual(gone, { interactionId: 'i1', windowId: 7, reason: 'invalidated' });
  assert.equal(hub.get(D), null);
  assert.equal(hub.epochOf(D), epochBefore + 1);
  assert.equal(hub.end({ id: 'i1', domain: D, seq: 2 }).ok, false, 'a late end is a graceful drop');
});

test('the epoch only moves on displacement, so begin does not reset it', () => {
  const hub = createInteractionHub();
  hub.begin({ id: 'i1', domain: D, windowId: 7, baseRev: 0, currentRev: 0 });
  assert.equal(hub.epochOf(D), 0);
  hub.end({ id: 'i1', domain: D, seq: 0 });
  hub.begin({ id: 'i2', domain: D, windowId: 7, baseRev: 0, currentRev: 0 });
  assert.equal(hub.epochOf(D), 0);
  hub.invalidate(D);
  assert.equal(hub.epochOf(D), 1);
});

test('cancel restores the baseline and commits nothing', () => {
  const hub = createInteractionHub();
  hub.begin({ id: 'i1', domain: D, windowId: 7, baseRev: 12, currentRev: 12 });
  hub.update({ id: 'i1', domain: D, seq: 1, value: { r: 9, g: 9, b: 9 } });
  const e = hub.end({ id: 'i1', domain: D, seq: 1, reason: 'cancel' });
  assert.equal(e.ok, true);
  assert.equal(e.commit, false);
  assert.equal(e.baseRev, 12);
  assert.equal(hub.get(D), null);
});

test('a stale end seq is refused rather than committing an older value', () => {
  const hub = createInteractionHub();
  hub.begin({ id: 'i1', domain: D, windowId: 7, baseRev: 0, currentRev: 0 });
  hub.update({ id: 'i1', domain: D, seq: 5, value: { r: 1, g: 2, b: 3 } });
  const e = hub.end({ id: 'i1', domain: D, seq: 4, value: { r: 9, g: 9, b: 9 } });
  assert.equal(e.ok, false);
  assert.equal(e.reason, 'stale-seq');
  assert.equal(hub.get(D).seq, 5, 'the interaction is still live');
});

test('causation names the owner and the accepted seq only while active', () => {
  const hub = createInteractionHub();
  assert.equal(hub.causation(D), null);
  hub.begin({ id: 'i1', domain: D, windowId: 7, baseRev: 0, currentRev: 0 });
  hub.update({ id: 'i1', domain: D, seq: 3, value: {} });
  assert.deepEqual(hub.causation(D), { originWindowId: 7, interactionId: 'i1', acceptedThroughSeq: 3 });
  hub.end({ id: 'i1', domain: D, seq: 3 });
  assert.equal(hub.causation(D), null);
});

test('two domains are independent', () => {
  const hub = createInteractionHub();
  hub.begin({ id: 'a', domain: 'color', windowId: 1, baseRev: 0, currentRev: 0 });
  hub.begin({ id: 'b', domain: 'layout', windowId: 2, baseRev: 0, currentRev: 0 });
  assert.equal(hub.invalidate('color').interactionId, 'a');
  assert.equal(hub.get('layout').id, 'b');
});

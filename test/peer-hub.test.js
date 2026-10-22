'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPeerHub } = require('../src/main/peer-hub');

test('opening a window pairs the hub and announces the peer', () => {
  const events = [];
  const hub = createPeerHub();
  hub.on('peer-connected', (d) => events.push(d.peer.peerId));
  hub.connect();
  assert.equal(hub.state(), 'connected');
  const peer = hub.openWindow(11, { kind: 'palette', title: 'Palette' });
  assert.match(peer.peerId, /^peer-\d+$/);
  assert.equal(hub.isPaired(), true);
  assert.equal(hub.state(), 'paired');
  assert.deepEqual(events, [peer.peerId]);
});

test('re-opening the same window does not duplicate the peer', () => {
  const hub = createPeerHub();
  const a = hub.openWindow(11);
  const b = hub.openWindow(11);
  assert.equal(a.peerId, b.peerId);
  assert.equal(hub.size(), 1);
});

test('closing the last window disconnects the session', () => {
  const events = [];
  const hub = createPeerHub();
  hub.connect();
  hub.openWindow(11);
  hub.on('peer-disconnected', (d) => events.push(d.peer.kind));
  hub.on('state', (d) => events.push(d.current));
  assert.equal(hub.closeWindow(11), true);
  assert.equal(hub.closeWindow(11), false); // already gone
  assert.equal(hub.isPaired(), false);
  assert.equal(hub.state(), 'disconnected');
  assert.deepEqual(events, ['window', 'disconnected']);
});

test('broadcastEvent reaches every peer through the injected send', () => {
  const sent = [];
  const hub = createPeerHub({ send: (wcId, channel, payload) => sent.push({ wcId, channel, payload }) });
  hub.openWindow(1);
  hub.openWindow(2);
  const n = hub.broadcastEvent('warning', { message: 'hi' });
  assert.equal(n, 2);
  assert.deepEqual(sent.map((s) => s.wcId).sort(), [1, 2]);
  assert.equal(sent[0].channel, 'peer:event');
  assert.deepEqual(sent[0].payload, { type: 'warning', data: { message: 'hi' } });
});

test('peers() lists live peers only', () => {
  const hub = createPeerHub();
  hub.openWindow(1, { kind: 'float' });
  hub.openWindow(2, { kind: 'settings' });
  hub.closeWindow(1);
  assert.deepEqual(hub.peers().map((p) => p.wcId), [2]);
});

test('allocatePort is consulted per window', () => {
  const hub = createPeerHub({ allocatePort: (wcId) => ({ port: wcId }) });
  assert.deepEqual(hub.openWindow(7).port, { port: 7 });
});

test('closing a window closes its port when it has one', () => {
  let closed = 0;
  const hub = createPeerHub({ allocatePort: () => ({ close: () => { closed += 1; } }) });
  hub.openWindow(11);
  assert.equal(hub.closeWindow(11), true);
  assert.equal(closed, 1);
  // A port that has no close() must not throw.
  const bare = createPeerHub({ allocatePort: () => ({}) });
  bare.openWindow(1);
  assert.equal(bare.closeWindow(1), true);
});

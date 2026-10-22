'use strict';

// Connection-lifecycle regression tests. They inject a fake CompanionClient so
// no socket is needed; each test file runs in its own process, so the patch
// cannot leak into service.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const clientPath = require.resolve('../src/main/companion/client');
const servicePath = require.resolve('../src/main/service');

let connectImpl = async function () {};
let authenticateImpl = async function () { this.alive = true; this.emit('authenticated', {}); return {}; };
let readColorImpl = async function () { return null; };

class FakeClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.closed = false;
    this.alive = false;
    this.password = cfg.password;
    this.remoteAddress = 'fake';
    this.serverSpecVersion = 'G#1:2022.12';
    this._handlers = {};
  }
  on(ev, fn) { (this._handlers[ev] ||= []).push(fn); }
  emit(ev, ...args) { for (const fn of this._handlers[ev] || []) fn(...args); }
  connect() { return connectImpl.call(this); }
  authenticate(opts) { return authenticateImpl.call(this, opts); }
  readColor() { return readColorImpl.call(this); }
  close() { this.closed = true; this.alive = false; }
}

const clientMod = require(clientPath);
clientMod.CompanionClient = FakeClient;
delete require.cache[servicePath];
const { CompanionService } = require(servicePath);
const { encodeConfig } = require('../src/main/companion/qr');

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeService(ips = ['10.0.0.1'], port = 15235, password = 'saved') {
  const settings = { get: () => ({ autoConnect: true, liveSync: true }) };
  const session = {
    _s: { ips, port, password, generation: 'G#1:2022.12' },
    get() { return { ...this._s }; },
    replace(v) { this._s = { ...v }; },
    clear() { this._s = {}; },
  };
  return new CompanionService({ settings, session });
}

test('a late stale reconnect failure cannot kill a newer connection', async () => {
  let rejectStale;
  connectImpl = function () { return new Promise((_, reject) => { rejectStale = reject; }); };

  const svc = makeService();
  const stale = svc.connectSaved(); // dialling the saved host, still pending
  await tick();

  // A manual pair wins while the stale dial is in flight.
  const manual = new FakeClient({ password: 'new' });
  manual.alive = true;
  svc.client = manual;
  svc._setState('connected', 'Connected (manual)');

  rejectStale(new Error('connect ECONNREFUSED'));
  await stale;

  assert.equal(svc.state, 'connected', 'state stays connected');
  assert.equal(svc.client, manual, 'the manual client is not cleared');
  assert.equal(manual.closed, false, 'the manual client is not closed');
  svc.disconnect();
});

test('a failed first colour read keeps a connection that authenticated', async () => {
  connectImpl = async function () {};
  authenticateImpl = async function () { this.alive = true; this.emit('authenticated', {}); return { serverSpecVersion: 'x' }; };
  readColorImpl = async function () { throw new Error('read timed out'); };

  const svc = makeService();
  const payload = encodeConfig({ ips: ['127.0.0.1'], port: 15235, password: 'qr', generation: 'G#1:2022.12' });
  await svc.pairWithPayload(payload);

  assert.equal(svc.state, 'connected');
  assert.equal(svc.client.closed, false);
  svc.disconnect();
});

test('a transient reconnect failure stays reconnecting and is not scanned over', async () => {
  connectImpl = async function () {};
  authenticateImpl = async function () { this.alive = true; this.emit('authenticated', {}); return { serverSpecVersion: 'x' }; };
  readColorImpl = async function () { return null; };

  const svc = makeService();
  const payload = encodeConfig({ ips: ['127.0.0.1'], port: 15235, password: 'qr', generation: 'G#1:2022.12' });
  await svc.pairWithPayload(payload);
  const client = svc.client;
  client.reconnecting = true;

  client.emit('reconnect-failed', new Error('connection refused'));
  assert.equal(svc.state, 'reconnecting', 'auto-connect must not mistake this for a dead pairing');
  assert.equal(svc.retrying(), true, 'the client owns its retry cycle');

  for (let i = 1; i < 4; i++) client.emit('reconnect-failed', new Error('connection refused'));
  assert.equal(svc.state, 'idle', 'four failures is a dead saved pairing');
  assert.equal(svc.client, null);
  assert.equal(svc.retrying(), false);
});

test('a newer pair supersedes an in-flight one without a disconnect', async () => {
  // The first pair never finishes; the second must own the connection and the
  // first's late failure must not clear it.
  let failFirst;
  let calls = 0;
  connectImpl = function () {
    calls += 1;
    if (calls === 1) return new Promise((_, reject) => { failFirst = reject; });
    return Promise.resolve();
  };
  authenticateImpl = async function () { this.alive = true; this.emit('authenticated', {}); return {}; };
  readColorImpl = async function () { return null; };

  const svc = makeService();
  const payload = encodeConfig({ ips: ['127.0.0.1'], port: 15235, password: 'qr', generation: 'G#1:2022.12' });
  const first = svc.pairWithPayload(payload);
  await tick();
  const second = svc.pairWithPayload(payload);
  await second;
  failFirst(new Error('superseded'));
  await first.catch(() => {});

  assert.equal(svc.state, 'connected');
  assert.equal(svc.client.closed, false);
  svc.disconnect();
});

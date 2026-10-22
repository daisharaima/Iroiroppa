'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const { parseAuthResult, parseColorState, CompanionClient } = require('../src/main/companion/client');
const { TYPE } = require('../src/main/companion/packets');

const MAX_U32 = 4294967295;

function pkt(type, detailRaw) {
  const raw = detailRaw == null ? Buffer.alloc(0) : Buffer.from(detailRaw);
  let detail = null;
  if (raw.length) {
    try { detail = JSON.parse(raw.toString('utf8')); } catch { detail = undefined; }
  }
  return { type, rawDetail: raw, detail };
}

test('parseAuthResult follows CSP semantics', () => {
  const cases = [
    ['bare success array', TYPE.SUCCESS, '[true,false]', true, ''],
    ['empty body success', TYPE.SUCCESS, '', true, ''],
    ['PasswordMismatch', TYPE.SUCCESS, '{"AuthErrorReason":"PasswordMismatch","RemoteCommandSpecVersionOfServer":"1.0","IsQuickAccessAvailable":true}', false, 'PasswordMismatch'],
    ['Unknown is success', TYPE.SUCCESS, '{"AuthErrorReason":"Unknown"}', true, 'Unknown'],
    ['VersionMismatch', TYPE.SUCCESS, '{"AuthErrorReason":"VersionMismatch"}', false, 'VersionMismatch'],
    ['bodyless error packet', TYPE.ERROR, '', false, ''],
  ];
  for (const [name, type, raw, ok, reason] of cases) {
    const res = parseAuthResult(pkt(type, raw));
    assert.equal(res.ok, ok, name);
    assert.equal(res.reason, reason, name);
  }
});

test('parseAuthResult surfaces the server spec version and quick access flag', () => {
  const res = parseAuthResult(pkt(TYPE.SUCCESS, '{"AuthErrorReason":"Unknown","RemoteCommandSpecVersionOfServer":"G#1:2022.12","IsQuickAccessAvailable":true}'));
  assert.equal(res.serverSpecVersion, 'G#1:2022.12');
  assert.equal(res.quickAccessAvailable, true);
});

test('parseColorState decodes uint32 HSV for the main slot', () => {
  const state = parseColorState({
    ColorSelectionModel: 'HSV',
    CurrentColorIndex: 0,
    HSVColorMainH: Math.round((180 / 360) * MAX_U32),
    HSVColorMainS: MAX_U32,
    HSVColorMainV: MAX_U32,
  });
  assert.ok(state);
  assert.deepEqual(state.rgb, { r: 0, g: 255, b: 255 });
  assert.ok(Math.abs(state.hsv.h - 180) < 0.01);
  assert.equal(state.index, 0);
});

test('parseColorState uses the sub slot when CurrentColorIndex is 1', () => {
  const state = parseColorState({
    ColorSelectionModel: 'HSV',
    CurrentColorIndex: 1,
    HSVColorMainH: 0,
    HSVColorMainS: 0,
    HSVColorMainV: 0,
    HSVColorSubH: 0,
    HSVColorSubS: MAX_U32,
    HSVColorSubV: MAX_U32,
  });
  assert.deepEqual(state.rgb, { r: 255, g: 0, b: 0 });
  assert.equal(state.index, 1);
});

test('parseColorState decodes the RGB (sub-view / color-mix) shape', () => {
  const state = parseColorState({ CurrentColorRed: 10, CurrentColorGreen: 20, CurrentColorBlue: 30 });
  assert.deepEqual(state.rgb, { r: 10, g: 20, b: 30 });
});

test('parseColorState reports a transparent-only (eraser) state', () => {
  const state = parseColorState({ IsCurrentColorTransparent: true, ColorSelectionModel: 'HSV', CurrentColorIndex: 0 });
  assert.ok(state);
  assert.equal(state.rgb, null);
  assert.equal(state.transparent, true);
});

test('parseColorState exposes main, sub and the active slot', () => {
  const state = parseColorState({
    ColorSelectionModel: 'HSV',
    CurrentColorIndex: 1,
    HSVColorMainH: 0, HSVColorMainS: MAX_U32, HSVColorMainV: MAX_U32,
    HSVColorSubH: Math.round((240 / 360) * MAX_U32), HSVColorSubS: MAX_U32, HSVColorSubV: MAX_U32,
  });
  assert.equal(state.active, 'sub');
  assert.deepEqual(state.main.rgb, { r: 255, g: 0, b: 0 });
  assert.deepEqual(state.sub.rgb, { r: 0, g: 0, b: 255 });
  assert.deepEqual(state.rgb, { r: 0, g: 0, b: 255 });
});

test('parseColorState marks transparent as the active slot', () => {
  const state = parseColorState({
    ColorSelectionModel: 'HSV',
    CurrentColorIndex: 0,
    IsCurrentColorTransparent: true,
    HSVColorMainH: 0, HSVColorMainS: MAX_U32, HSVColorMainV: MAX_U32,
    HSVColorSubH: 0, HSVColorSubS: 0, HSVColorSubV: MAX_U32,
  });
  assert.equal(state.active, 'transparent');
  assert.equal(state.transparent, true);
  assert.deepEqual(state.main.rgb, { r: 255, g: 0, b: 0 });
});

test('parseColorState marks a partial payload without clobbering the active colour', () => {
  const full = parseColorState({
    ColorSelectionModel: 'HSV',
    CurrentColorIndex: 1,
    HSVColorMainH: 0, HSVColorMainS: MAX_U32, HSVColorMainV: MAX_U32,
    HSVColorSubH: 0, HSVColorSubS: MAX_U32, HSVColorSubV: MAX_U32,
  });
  assert.equal(full.partial, false);
  assert.equal(full.active, 'sub');
  assert.ok(full.rgb);

  // No sub channels even though index says sub is active -> partial diff.
  const partial = parseColorState({
    ColorSelectionModel: 'HSV',
    CurrentColorIndex: 1,
    HSVColorMainH: 0, HSVColorMainS: MAX_U32, HSVColorMainV: MAX_U32,
  });
  assert.equal(partial.partial, true);
  assert.equal(partial.active, null);
  assert.equal(partial.rgb, null);
  assert.deepEqual(partial.main.rgb, { r: 255, g: 0, b: 0 });
});

test('parseColorState returns null when there is no color', () => {
  assert.equal(parseColorState({}), null);
  assert.equal(parseColorState(null), null);
});

test('the heartbeat carries the idle-timer reset only while sync is active', () => {
  const client = new CompanionClient({ ips: ['127.0.0.1'], port: 1, generation: 'g', password: 'p' });
  const sent = [];
  client.request = (command, detail) => { sent.push({ command, detail }); return Promise.resolve({}); };
  client.alive = true;
  client.socket = { destroyed: false };

  assert.equal(client.syncActive, true, 'a bare client defaults to active');
  client._sendHeartbeat();
  assert.deepEqual(sent.at(-1), { command: 'TellHeartbeat', detail: { IdleTimerResetRequested: true } });

  client.setSyncActive(false);
  assert.equal(sent.length, 1, 'going passive does not fire an extra heartbeat');
  client._sendHeartbeat();
  assert.deepEqual(sent.at(-1), { command: 'TellHeartbeat', detail: null },
    'a passive heartbeat keeps the socket alive but lets the idle timer run');

  client.setSyncActive(true);
  assert.deepEqual(sent.at(-1), { command: 'TellHeartbeat', detail: { IdleTimerResetRequested: true } },
    'going active clears the idle gate at once');
});

test('close() settles a connect that is still dialling', async () => {
  // A socket that never emits connect/error stands in for an unreachable host,
  // which used to leave connect() pending forever after a teardown.
  const realCreate = net.createConnection;
  net.createConnection = () => new net.Socket();
  try {
    const client = new CompanionClient({ ips: ['10.255.255.1'], port: 59999, generation: 'x', password: 'p' });
    const pending = client.connect();
    client.close();
    await assert.rejects(pending, /connection closed/);
  } finally {
    net.createConnection = realCreate;
  }
});

test('attaching a new socket closes the old one first', () => {
  const fake = (tag) => {
    const sock = {
      remoteAddress: tag, remotePort: 1, destroyed: false, listeners: 0,
      on() { sock.listeners += 1; return sock; },
      removeAllListeners() { sock.listeners = 0; return sock; },
      destroy() { sock.destroyed = true; },
    };
    return sock;
  };
  const client = new CompanionClient({ ips: ['127.0.0.1'], port: 1, generation: 'x', password: 'p' });
  const first = fake('a');
  const second = fake('b');
  client._attach(first);
  client._attach(second);
  assert.equal(first.destroyed, true, 'the superseded socket must be torn down');
  assert.equal(second.destroyed, false, 'the live socket stays open');
  assert.equal(client.socket, second);
});

test('reconnect backoff starts at 250 ms and is capped at 5 s', () => {
  const client = new CompanionClient({ ips: ['127.0.0.1'], port: 1, generation: 'x', password: 'p' });
  const delays = [];
  client.on('reconnecting', (d) => delays.push(d));
  for (let i = 0; i < 10; i++) {
    client.reconnecting = false;
    client._scheduleReconnect();
  }
  assert.equal(delays[0], 250);
  assert.ok(delays.every((d) => d <= 5000), `a delay above the cap: ${delays.join(', ')}`);
  assert.equal(delays.at(-1), 5000);
  client.close();
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sameColor } = require('../src/main/service');
const { CompanionService } = require('../src/main/service');

function makeService() {
  const settings = { get: () => ({}), set: () => ({}) };
  const session = { get: () => ({}), replace: () => ({}), clear: () => ({}) };
  return new CompanionService({ settings, session });
}

test('the sync gate lets CSP pause worktime while the user is away', () => {
  let idle = 0;
  let visible = true;
  let cspActive = true;
  const settings = { get: () => ({}), set: () => ({}) };
  const session = { get: () => ({}), replace: () => ({}), clear: () => ({}) };
  const svc = new CompanionService({
    settings,
    session,
    systemIdleSeconds: () => idle,
    windowVisible: () => visible,
    cspForeground: () => cspActive,
  });
  const calls = [];
  const reads = [];
  svc.client = {
    alive: true,
    setSyncActive: (on) => calls.push(on),
    readColor: () => { reads.push(1); return Promise.resolve(null); },
  };
  svc._ensurePolling();

  // Recent input and the palette on screen: keep the host awake.
  svc._lastGateAt = 0;
  svc._pollTick();
  assert.equal(svc._syncActive, true);
  assert.deepEqual(calls, [], 'staying active needs no flip');

  // Another app is foreground: even with the palette visible and recent input,
  // do not hold CSP's worktime timer awake.
  cspActive = false;
  svc._lastGateAt = 0;
  svc._pollTick();
  assert.equal(svc._syncActive, false, 'CSP must be foreground to reset its idle timer');
  assert.deepEqual(calls, [false]);
  cspActive = true;
  svc._lastGateAt = 0;
  svc._pollTick();
  assert.equal(svc._syncActive, true);
  assert.deepEqual(calls, [false, true]);

  // The user walks away: go passive and stop polling so CSP can pause.
  idle = 60;
  svc._lastGateAt = 0;
  svc._pollTick();
  assert.equal(svc._syncActive, false);
  assert.deepEqual(calls, [false, true, false], 'the heartbeat is told to stop resetting');
  const readsWhenPassive = reads.length;
  svc._lastGateAt = 0;
  svc._pollTick();
  assert.equal(reads.length, readsWhenPassive, 'no Sync* while passive');

  // A hidden palette parks the host even when the machine is being used.
  visible = false;
  idle = 0;
  svc._lastGateAt = 0;
  svc._pollTick();
  assert.equal(svc._syncActive, false, 'a hidden palette stays passive');
  assert.deepEqual(calls, [false, true, false]);

  // Back to work: the palette is up and there is input again.
  visible = true;
  svc._lastGateAt = 0;
  svc._pollTick();
  assert.equal(svc._syncActive, true);
  assert.deepEqual(calls, [false, true, false, true]);

  svc._stopPolling();
});

test('selectSlot activates a slot by writing its own colour back', async () => {
  const svc = makeService();
  const calls = [];
  svc.client = {
    alive: true,
    setSlotColor: (index, hsv) => { calls.push(['slot', index, hsv]); return Promise.resolve(); },
    setTransparent: () => { calls.push(['transparent']); return Promise.resolve(); },
  };
  svc.lastColor = {
    main: { rgb: { r: 255, g: 0, b: 0 }, hsv: { h: 0, s: 1, v: 1 } },
    sub: { rgb: { r: 0, g: 0, b: 255 }, hsv: { h: 240, s: 1, v: 1 } },
    active: 'main', transparent: false, rgb: { r: 255, g: 0, b: 0 },
  };
  const emitted = [];
  svc.on('color', (c) => emitted.push(c.active));

  assert.equal(await svc.selectSlot('sub'), true);
  assert.deepEqual(calls[0], ['slot', 1, { h: 240, s: 1, v: 1 }]);
  assert.equal(svc.lastColor.active, 'sub');

  assert.equal(await svc.selectSlot('transparent'), true);
  assert.deepEqual(calls[1], ['transparent']);
  assert.equal(svc.lastColor.active, 'transparent');
  assert.deepEqual(emitted, ['sub', 'transparent']);
});

test('selectSlot is a no-op when not connected or the slot is unknown', async () => {
  const svc = makeService();
  assert.equal(await svc.selectSlot('main'), false);
  svc.client = { alive: true };
  svc.lastColor = { main: null, sub: null, active: 'main', transparent: false };
  assert.equal(await svc.selectSlot('main'), false);
  assert.equal(await svc.selectSlot('bogus'), false);
});

test('selectSlot derives HSV when a cached slot has only RGB', async () => {
  const svc = makeService();
  const calls = [];
  svc.client = {
    alive: true,
    setSlotColor: (index, hsv) => { calls.push([index, hsv]); return Promise.resolve(); },
  };
  // As left by a write: the active slot carries RGB but no HSV.
  svc.lastColor = {
    main: { rgb: { r: 255, g: 0, b: 0 }, hsv: null },
    sub: { rgb: { r: 0, g: 0, b: 255 } },
    active: 'main',
    transparent: false,
    rgb: { r: 255, g: 0, b: 0 },
  };
  assert.equal(await svc.selectSlot('main'), true);
  assert.equal(calls[0][0], 0);
  assert.ok(Math.abs(calls[0][1].h) < 0.01 && Math.abs(calls[0][1].s - 1) < 1e-6 && Math.abs(calls[0][1].v - 1) < 1e-6);
  assert.equal(await svc.selectSlot('sub'), true);
  assert.equal(calls[1][0], 1);
  assert.ok(Math.abs(calls[1][1].h - 240) < 0.01, `hue ${calls[1][1].h}`);
});

test('a partial payload cannot blank a slot or fabricate a change', () => {
  const svc = makeService();
  svc.client = { alive: true, setColorRgb: () => Promise.resolve() };
  svc.lastColor = {
    main: { rgb: { r: 10, g: 20, b: 30 } },
    sub: { rgb: { r: 40, g: 50, b: 60 } },
    rgb: { r: 40, g: 50, b: 60 },
    active: 'sub',
    transparent: false,
  };
  const emitted = [];
  svc.on('color', (c) => emitted.push(c));

  // Partial diff: only the main slot, no active colour.
  svc._emitIfChanged({ main: { rgb: { r: 10, g: 20, b: 30 } }, sub: null, rgb: null, active: null, transparent: false });
  assert.equal(emitted.length, 0, 'no spurious emit');
  assert.deepEqual(svc.lastColor.sub.rgb, { r: 40, g: 50, b: 60 }, 'sub is preserved');
  assert.equal(svc.lastColor.active, 'sub', 'active is preserved');

  // A real change to the sub slot still emits.
  svc._emitIfChanged({ main: null, sub: { rgb: { r: 1, g: 2, b: 3 } }, rgb: { r: 1, g: 2, b: 3 }, active: 'sub', transparent: false });
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0].sub.rgb, { r: 1, g: 2, b: 3 });
});

test('sameColor tolerates 1/255 channel noise', () => {
  const a = { rgb: { r: 10, g: 20, b: 30 }, transparent: false };
  assert.equal(sameColor(a, { rgb: { r: 11, g: 19, b: 31 }, transparent: false }), true);
  assert.equal(sameColor(a, { rgb: { r: 13, g: 20, b: 30 }, transparent: false }), false);
});

test('sameColor treats a transparency change as different', () => {
  const solid = { rgb: { r: 10, g: 20, b: 30 }, transparent: false };
  const transparent = { rgb: { r: 10, g: 20, b: 30 }, transparent: true };
  assert.equal(sameColor(solid, transparent), false);
  assert.equal(sameColor({ rgb: null, transparent: true }, { rgb: null, transparent: true }), true);
  assert.equal(sameColor({ rgb: null, transparent: true }, solid), false);
});

test('sameColor handles missing values', () => {
  const a = { rgb: { r: 1, g: 2, b: 3 }, transparent: false };
  assert.equal(sameColor(null, a), false);
  assert.equal(sameColor(a, null), false);
  assert.equal(sameColor(a, a), true);
});

test('sameColor detects slot and active-slot changes', () => {
  const a = {
    rgb: { r: 255, g: 0, b: 0 }, transparent: false, active: 'main',
    main: { rgb: { r: 255, g: 0, b: 0 } }, sub: { rgb: { r: 0, g: 0, b: 255 } },
  };
  assert.equal(sameColor(a, { ...a }), true);
  assert.equal(sameColor(a, { ...a, active: 'sub' }), false);
  assert.equal(sameColor(a, { ...a, sub: { rgb: { r: 0, g: 0, b: 128 } } }), false);
});

test('readColor merges partial payloads instead of blanking slots', async () => {
  const svc = makeService();
  // A partial diff that carries none of the active colour must not replace the
  // known state (previously readColor assigned it verbatim).
  svc.client = {
    alive: true,
    readColor: async () => ({ main: null, sub: null, rgb: null, active: null, transparent: false }),
  };
  svc.lastColor = {
    main: { rgb: { r: 10, g: 20, b: 30 } },
    sub: { rgb: { r: 40, g: 50, b: 60 } },
    rgb: { r: 40, g: 50, b: 60 },
    active: 'sub',
    transparent: false,
  };
  const emitted = [];
  svc.on('color', (c) => emitted.push(c));

  await svc.readColor();
  assert.deepEqual(svc.lastColor.sub.rgb, { r: 40, g: 50, b: 60 }, 'sub is preserved');
  assert.equal(svc.lastColor.active, 'sub', 'active is preserved');
  assert.equal(emitted.length, 0, 'no spurious emit');

  // A partial that does update a slot merges it and keeps the rest.
  svc.client.readColor = async () => ({ main: { rgb: { r: 1, g: 2, b: 3 } }, sub: null, rgb: null, active: null });
  await svc.readColor();
  assert.deepEqual(svc.lastColor.main.rgb, { r: 1, g: 2, b: 3 }, 'main is updated');
  assert.deepEqual(svc.lastColor.sub.rgb, { r: 40, g: 50, b: 60 }, 'sub is still preserved');
});

test('quickAccess reports failure when CSP answers with an ERROR packet', async () => {
  const { TYPE } = require('../src/main/companion/packets');
  const svc = makeService();
  svc.client = { alive: true, request: async () => ({ type: TYPE.ERROR, command: 'DoQuickAccess' }) };
  const res = await svc.quickAccess(3);
  assert.equal(res.ok, false, 'a NAK must not look like success');
  svc.client = { alive: true, request: async () => ({ type: TYPE.SUCCESS }) };
  assert.equal((await svc.quickAccess(3)).ok, true);
});

test('a queued write survives a dead socket instead of being recorded as sent', () => {
  const svc = makeService();
  svc.client = { alive: false, setColorRgb: () => { throw new Error('must not be called'); } };
  svc._pendingWrite = { r: 1, g: 2, b: 3 };
  svc.lastColor = null;
  svc._flushWrite();
  assert.deepEqual(svc._pendingWrite, { r: 1, g: 2, b: 3 }, 'the value is kept for the reconnect');
  assert.equal(svc.lastColor, null, 'nothing is shown as written');
});

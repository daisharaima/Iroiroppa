'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const APP_MODULE = path.join(__dirname, '..', 'src', 'main', 'ipc', 'app.js');

/** An Electron surface good enough to register every channel in `ipc/app.js`. */
function electronStub() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    api: {
      app: {
        getVersion: () => '0.0.0',
        isPackaged: false,
        getAppPath: () => process.cwd(),
        getPath: () => process.cwd(),
      },
      ipcMain: {
        handle: (channel, fn) => { handlers.set(channel, fn); },
        on: (channel, fn) => { listeners.set(channel, fn); },
      },
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      shell: { openPath: async () => '', openExternal: async () => true },
    },
  };
}

/** Require the real group module against the stub, with `Module._load` always restored. */
function loadApp() {
  const stub = electronStub();
  const original = Module._load;
  let mod;
  try {
    Module._load = function (request, ...rest) {
      if (request === 'electron') return stub.api;
      return original.call(this, request, ...rest);
    };
    delete require.cache[require.resolve(APP_MODULE)];
    mod = require(APP_MODULE);
  } finally {
    Module._load = original;

    delete require.cache[require.resolve(APP_MODULE)];
  }
  return { register: mod.register, stub };
}

/** The app context `register()` needs; only the peer hub is exercised. */
function makeCtx() {
  const peers = [{ peerId: 'peer-1', wcId: 1, kind: 'palette', title: 'Palette' }];
  const opened = [];
  let broadcasts = 0;
  return {
    ctx: {
      peerHub: {
        openWindow: (id, meta) => { opened.push({ id, meta }); },
        state: () => ({ focused: 'peer-1' }),
        peers: () => peers,
      },
      broadcastPeers: () => { broadcasts += 1; },
    },
    opened,
    broadcasts: () => broadcasts,
  };
}

/** Register the group and hand back the captured `peer:hello` listener. */
function peerHelloListener(register, stub, ctx) {
  register(ctx, () => true);
  const listener = stub.listeners.get('peer:hello');
  assert.ok(listener, 'peer:hello is registered on ipcMain');
  return listener;
}

test('a destroyed sender is never sent to and the listener does not throw', () => {
  const { register, stub } = loadApp();
  const { ctx } = makeCtx();
  const listener = peerHelloListener(register, stub, ctx);

  const calls = [];
  const sender = {
    id: 7,
    isDestroyed: () => true,
    send: (...args) => { calls.push(args); throw new Error('Object has been destroyed'); },
  };

  assert.doesNotThrow(() => listener({ sender }, { kind: 'palette' }),
    'a dead webContents must not raise out of the listener');
  assert.equal(calls.length, 0, 'a destroyed webContents receives nothing');
});

test('a live sender whose send throws is isolated, and both replies are still attempted', () => {
  const { register, stub } = loadApp();
  const { ctx } = makeCtx();
  const listener = peerHelloListener(register, stub, ctx);

  let calls = 0;
  const sender = {
    id: 8,
    isDestroyed: () => false,
    send: () => { calls += 1; throw new Error('send failed'); },
  };

  assert.doesNotThrow(() => listener({ sender }, {}),
    'a throwing send must not propagate out of the listener');
  assert.equal(calls, 2, 'both replies are attempted: peer:event then peer:peers');
});

test('a live sender receives exactly peer:event and peer:peers', () => {
  const { register, stub } = loadApp();
  const { ctx, opened, broadcasts } = makeCtx();
  const listener = peerHelloListener(register, stub, ctx);

  const sent = [];
  const sender = {
    id: 9,
    isDestroyed: () => false,
    send: (channel, payload) => { sent.push({ channel, payload }); },
  };

  listener({ sender }, { kind: 'palette' });

  assert.deepEqual(sent.map((entry) => entry.channel), ['peer:event', 'peer:peers'],
    'the two replies, in that order');
  assert.deepEqual(sent[0].payload, { type: 'state', data: { current: { focused: 'peer-1' } } });
  assert.deepEqual(sent[1].payload, [
    { peerId: 'peer-1', wcId: 1, kind: 'palette', title: 'Palette' },
  ]);
  assert.equal(opened.length, 1, 'the announcing window is still registered with the hub');
  assert.equal(opened[0].id, 9);
  assert.equal(broadcasts(), 1, 'the other windows are still told about the new peer');
});

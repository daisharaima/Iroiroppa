'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const WINDOW_MODULE = path.join(__dirname, '..', 'src', 'main', 'ipc', 'window.js');

function electronStub() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    api: {
      app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => process.cwd() },
      BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
      ipcMain: {
        handle: (channel, fn) => { handlers.set(channel, fn); },
        on: (channel, fn) => { listeners.set(channel, fn); },
      },
      clipboard: { readText: () => '' },
      dialog: { showMessageBox: async () => ({ response: 0 }) },
      screen: {
        getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
        getAllDisplays: () => [],
      },
      webContents: { getAllWebContents: () => [] },
    },
  };
}

function loadWindowIpc() {
  const stub = electronStub();
  const original = Module._load;
  let mod;
  try {
    Module._load = function (request, ...rest) {
      if (request === 'electron') return stub.api;
      return original.call(this, request, ...rest);
    };
    delete require.cache[require.resolve(WINDOW_MODULE)];
    mod = require(WINDOW_MODULE);
  } finally {
    Module._load = original;
    delete require.cache[require.resolve(WINDOW_MODULE)];
  }
  return { register: mod.register, stub };
}

function helpers() {
  return {
    instanceOf: () => null,
    findInstance: () => null,
    moduleIdOfInstance: () => null,
    isSingletonModule: () => false,
    paletteIdForSender: () => null,
    commitSettings: () => {},
    trusted: () => true,
  };
}

test('window:editable-self acts on the sender window, never on the palette', () => {
  const { register, stub } = loadWindowIpc();
  const calls = [];
  const ctx = {
    setWindowEditable: (win, on) => calls.push(['window', win.name, on]),
    setPaletteEditable: (on) => calls.push(['palette', null, on]),
  };
  register(ctx, helpers());
  const listener = stub.listeners.get('window:editable-self');
  assert.ok(listener, 'window:editable-self is registered');

  const sender = { id: 42 };
  const floatWin = { name: 'float', isDestroyed: () => false };
  stub.api.BrowserWindow.fromWebContents = (wc) => (wc === sender ? floatWin : null);
  listener({ sender }, true);

  assert.deepEqual(calls, [['window', 'float', true]]);
});

test('window:editable-self ignores a sender with no live window', () => {
  const { register, stub } = loadWindowIpc();
  const calls = [];
  const ctx = {
    setWindowEditable: () => calls.push('window'),
    setPaletteEditable: () => calls.push('palette'),
  };
  register(ctx, helpers());
  const listener = stub.listeners.get('window:editable-self');
  stub.api.BrowserWindow.fromWebContents = () => null;

  listener({ sender: { id: 7 } }, true);

  assert.deepEqual(calls, []);
});
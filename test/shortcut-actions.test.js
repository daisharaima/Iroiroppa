'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createShortcutActions } = require('../src/main/shortcut-actions');
const Model = require('../src/shared/shortcut-model');

function harness({ shortcuts = Model.defaults(), commandBindings = {}, visible = ['p1'] } = {}) {
  const registered = new Map();
  const globalShortcut = {
    register: (accel) => {
      if (registered.has(accel)) return false;
      registered.set(accel, true);
      return true;
    },
    unregister: (accel) => { registered.delete(accel); },
  };
  const watchers = [];
  const bareWatchers = [];
  class HoldWatcher extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; watchers.push(this); }
    start() { return true; }
    stop() { this.stopped = true; }
  }
  class BareWatcher extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.active = true;
      this.typing = false;
      this.commands = [];
      bareWatchers.push(this);
    }
    start() { this.started = true; return true; }
    stop() { this.stopped = true; }
    setActive(value) { this.active = value; this.commands.push(['active', value]); }
    setTyping(value) { this.typing = value; this.commands.push(['typing', value]); }
    setCanvas(value) { this.canvas = value; this.commands.push(['canvas', value]); }
    setBusy(value) { this.busy = value; this.commands.push(['busy', value]); }
    setObserve(value) { this.observe = value; this.commands.push(['observe', value]); }
  }
  let settings = { shortcuts, commandBindings };
  const events = [];
  const shown = new Set(visible);
  let timerFn = null;
  const ids = ['p1', 'p2'];
  const snapshot = () => ({ palette: Object.fromEntries(ids.map((id) => [id, shown.has(id)])), settings: false });
  const ctx = {
    settings: {
      get: () => settings,
      commit: (patch) => { settings = { ...settings, ...patch }; events.push(['commit', patch]); },
    },
    isShortcutActive: () => true,
    paletteExists: (id) => ids.includes(id),
    paletteIds: () => ids.slice(),
    primaryPaletteId: () => 'p1',
    paletteVisible: (id) => shown.has(id),
    anyBandVisible: () => shown.size > 0,
    captureShortcutVisibility: () => snapshot(),
    restoreShortcutVisibility: (snap) => {
      shown.clear();
      for (const [id, on] of Object.entries((snap && snap.palette) || {})) if (on) shown.add(id);
      events.push(['restore']);
    },
    showShortcutTarget: (target, opts) => {
      events.push(['showTarget', target, opts || {}]);
      if (target === 'app') for (const id of ids) shown.add(id);
      else if (target.startsWith('palette:')) shown.add(target.slice('palette:'.length));
    },
    hidePaletteWindow: (id, opts) => {
      events.push(['hidePalette', id, opts || {}]);
      shown.delete(id);
    },
    hidePopup: () => { events.push(['hideAll']); shown.clear(); },
    positionShortcutWindow: (id, mode) => events.push(['position', id, mode]),
    clearAfterPickShortcut: () => {},
  };
  const actions = createShortcutActions(ctx, {
    globalShortcut,
    HoldWatcher,
    BareWatcher,
    checkHold: async () => ({ ok: true }),
    setTimeout: (fn) => { timerFn = fn; return { unref() {} }; },
    clearTimeout: () => { timerFn = null; },
  });
  return {
    actions, registered, watchers, bareWatchers, ctx, events,
    settings: () => settings,
    shown,
    timer: () => timerFn,
  };
}

test('apply registers only the selected mode', () => {
  const h = harness({
    shortcuts: Model.normalise({
      app: { mode: 'toggle', toggle: 'Ctrl+Alt+P', hold: 'Ctrl+Alt+H' },
      palettes: { p1: { mode: 'hold', toggle: 'Ctrl+Alt+1', hold: 'Ctrl+Alt+2' } },
    }),
  });
  const out = h.actions.apply(h.settings());
  assert.equal(out.ok, true);
  assert.deepEqual([...h.registered.keys()], ['Ctrl+Alt+P']);
  assert.equal(h.watchers.length, 1, 'one hold watcher for the palette');
  assert.equal(h.watchers[0].opts.accel, 'Ctrl+Alt+2');
});

test('hold watchers start with Auto-hide on or off', () => {
  const h = harness({
    shortcuts: Model.normalise({ app: { mode: 'hold', hold: 'Ctrl+Alt+H' } }),
  });
  h.actions.apply(h.settings());
  assert.equal(h.watchers.length, 1);
});

test('setting a duplicate accelerator is refused', async () => {
  const h = harness({
    shortcuts: Model.normalise({
      app: { mode: 'toggle', toggle: 'Ctrl+Alt+P' },
      palettes: { p1: { mode: 'toggle', toggle: 'Ctrl+Alt+1' } },
    }),
  });
  h.actions.apply(h.settings());
  const out = await h.actions.set({ target: 'app', action: 'toggle', accel: 'Ctrl+Alt+1' });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'conflict');
});

test('setting a key for a mode the target is not in is refused', async () => {
  const h = harness({
    shortcuts: Model.normalise({ app: { mode: 'toggle', toggle: 'Ctrl+Alt+P' } }),
  });
  const out = await h.actions.set({ target: 'app', action: 'hold', accel: 'Ctrl+Alt+H' });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'mode-mismatch');
});

test('clearing a binding unregisters its key', async () => {
  const h = harness({
    shortcuts: Model.normalise({ app: { mode: 'toggle', toggle: 'Ctrl+Alt+P' } }),
  });
  h.actions.apply(h.settings());
  const out = await h.actions.set({ target: 'app', action: 'toggle', accel: '' });
  assert.equal(out.ok, true);
  assert.equal(h.registered.has('Ctrl+Alt+P'), false);
  assert.equal(h.settings().shortcuts.app.toggle, '');
});

test('General toggle hides all when anything is visible and shows all when empty', () => {
  const h = harness({ visible: ['p1'] });
  h.actions.apply(h.settings());
  h.actions.toggleTarget('app');
  assert.deepEqual([...h.shown], []);
  assert.ok(h.events.some((e) => e[0] === 'hideAll'));

  h.actions.toggleTarget('app');
  assert.deepEqual([...h.shown].sort(), ['p1', 'p2']);
});

test('a palette toggle hides only that palette and marks it suppressed', () => {
  const h = harness({ visible: ['p1', 'p2'] });
  h.actions.apply(h.settings());
  h.actions.toggleTarget('palette:p1');
  assert.deepEqual([...h.shown], ['p2']);
  assert.ok(h.events.some((e) => e[0] === 'hidePalette' && e[1] === 'p1' && e[2].suppress === true));
});

test('hold shows a hidden palette and restores it on release', () => {
  const h = harness({
    visible: [],
    shortcuts: Model.normalise({ palettes: { p1: { mode: 'hold', hold: 'Ctrl+1' } } }),
  });
  h.actions.apply(h.settings());
  h.actions.beginHold('palette:p1', 'palette:p1:hold');
  assert.ok(h.shown.has('p1'));
  h.actions.endHold('palette:p1:hold');
  assert.equal(h.shown.has('p1'), false);
});

test('switching a target out of hold restores the hold snapshot', () => {
  const h = harness({
    visible: [],
    shortcuts: Model.normalise({ app: { mode: 'hold', hold: 'Ctrl+H' } }),
  });
  h.actions.apply(h.settings());
  h.actions.beginHold('app', 'app:hold');
  assert.ok(h.shown.has('p1'));
  h.actions.setOption({ target: 'app', option: 'mode', value: 'toggle' });
  assert.equal(h.shown.has('p1'), false);
});

test('after-pick reveals hidden windows and the next drawing stroke hides only those', () => {
  const h = harness({
    visible: ['p2'],
    shortcuts: Model.normalise({ app: { mode: 'afterPick' } }),
  });
  h.actions.apply(h.settings());
  assert.equal(h.actions.afterColorPick(), true);
  assert.deepEqual([...h.shown].sort(), ['p1', 'p2']);
  h.actions.drawingStarted();
  assert.deepEqual([...h.shown], ['p2'], 'the window that was already open stays open');
});

test('after-pick does not claim a window that was already visible', () => {
  const h = harness({
    visible: ['p1', 'p2'],
    shortcuts: Model.normalise({ app: { mode: 'afterPick' } }),
  });
  h.actions.apply(h.settings());
  assert.equal(h.actions.afterColorPick(), false);
  h.actions.drawingStarted();
  assert.deepEqual([...h.shown].sort(), ['p1', 'p2']);
});

test('after-pick timer hides the windows it opened', () => {
  const h = harness({
    visible: [],
    shortcuts: Model.normalise({ app: { mode: 'afterPick' } }),
  });
  h.actions.apply(h.settings());
  h.actions.afterColorPick();
  assert.equal(typeof h.timer(), 'function');
  h.timer()();
  assert.deepEqual([...h.shown], []);
});

test('after-pick is a no-op when no target opted in', () => {
  const h = harness({ visible: [] });
  h.actions.apply(h.settings());
  assert.equal(h.actions.afterColorPick(), false);
});

test('toggle auto-dismiss hides only what the toggle opened', () => {
  const h = harness({
    visible: [],
    shortcuts: Model.normalise({ app: { mode: 'toggle', toggle: 'Ctrl+P', autoDismiss: true } }),
  });
  h.actions.apply(h.settings());
  h.actions.toggleTarget('app');
  assert.deepEqual([...h.shown].sort(), ['p1', 'p2']);
  h.actions.interactionStarted({ canvas: true, alt: false });
  assert.deepEqual([...h.shown], []);
  assert.ok(h.events.some((e) => e[0] === 'hideAll'));
});

test('auto-dismiss off leaves a toggled window up on CSP interaction', () => {
  const h = harness({
    visible: [],
    shortcuts: Model.normalise({ app: { mode: 'toggle', toggle: 'Ctrl+P' } }),
  });
  h.actions.apply(h.settings());
  h.actions.toggleTarget('app');
  h.actions.interactionStarted({ canvas: true, alt: false });
  assert.deepEqual([...h.shown].sort(), ['p1', 'p2']);
});

test('a bare toggle uses the keyboard-hook watcher and follows foreground/typing state', () => {
  const h = harness({
    visible: [],
    shortcuts: Model.normalise({ app: { mode: 'toggle', toggle: 'H' } }),
  });
  h.actions.apply(h.settings());
  assert.equal(h.registered.size, 0);
  assert.equal(h.bareWatchers.length, 1);
  const watcher = h.bareWatchers[0];
  assert.equal(watcher.started, true);
  h.actions.setBareActive(false);
  assert.deepEqual(watcher.commands.at(-1), ['active', false]);
  h.actions.setBareTyping(true);
  assert.deepEqual(watcher.commands.at(-1), ['typing', true]);
  watcher.emit('down');
  assert.deepEqual([...h.shown].sort(), ['p1', 'p2']);
  watcher.emit('up');
});

test('a bare key bound to a module command uses the hook, not globalShortcut', () => {
  const h = harness({ visible: [] });
  let ran = 0;
  const res = h.actions.registerCommandBare({
    key: 'i_1:apply_r1', accel: 'S', run: () => { ran += 1; },
  });
  assert.deepEqual(res, { ok: true });
  assert.equal(h.registered.size, 0, 'a bare key is never a globalShortcut (it would swallow typing)');
  assert.equal(h.bareWatchers.length, 1, 'it is watched by the keyboard hook instead');
  const watcher = h.bareWatchers[0];
  assert.equal(watcher.started, true);

  watcher.emit('down');
  assert.equal(ran, 1);

  h.actions.setBareActive(false);
  assert.deepEqual(watcher.commands.at(-1), ['active', false]);
  h.ctx.isShortcutActive = () => false;
  watcher.emit('down');
  assert.equal(ran, 1, 'the command does not run while the foreground is not ours');
  h.ctx.isShortcutActive = () => true;

  h.actions.clearCommandBare('i_1:apply_r1');
  assert.equal(watcher.stopped, true);

  assert.equal(h.actions.registerCommandBare({ key: 'i_1:apply_r1', accel: 'S', run() {} }).ok, true);
  assert.equal(h.bareWatchers.length, 2);
});

test('a chord is refused by the bare-key path', () => {
  const h = harness({ visible: [] });
  assert.deepEqual(h.actions.registerCommandBare({ key: 'k', accel: 'Ctrl+G', run() {} }),
    { ok: false, error: 'invalid' }, 'a chord belongs to globalShortcut, not the hook');
  assert.equal(h.bareWatchers.length, 0);
});

test('stop() releases every bare command binding', () => {
  const h = harness({ visible: [] });
  h.actions.registerCommandBare({ key: 'a:cmd1', accel: 'S', run() {} });
  h.actions.registerCommandBare({ key: 'b:cmd2', accel: 'Q', run() {} });
  assert.equal(h.bareWatchers.length, 2);
  h.actions.stop();
  for (const w of h.bareWatchers) assert.equal(w.stopped, true);
});

test('the canvas gate reaches both bare-key paths', () => {

  const h = harness({
    visible: [],
    shortcuts: Model.normalise({ app: { mode: 'toggle', toggle: 'H' } }),
  });
  h.actions.apply(h.settings());
  assert.equal(h.bareWatchers.length, 1, 'the reveal key is on the hook path');
  const reveal = h.bareWatchers[0];
  h.actions.registerCommandBare({ key: 'i_1:apply_r1', accel: 'S', run() {} });
  assert.equal(h.bareWatchers.length, 2, 'a bare module command joins it');
  const command = h.bareWatchers[1];

  h.actions.setBareCanvas(true);
  for (const w of [reveal, command]) assert.equal(w.canvas, true);
  h.actions.setBareCanvas(false);
  for (const w of [reveal, command]) assert.equal(w.canvas, false);
});

test('CSP refusing a command mutes bare keys, and observer mode still reports them', () => {

  const h = harness({
    visible: [],
    shortcuts: Model.normalise({ app: { mode: 'toggle', toggle: 'H' } }),
  });
  h.actions.apply(h.settings());
  const reveal = h.bareWatchers[0];
  h.actions.registerCommandBare({ key: 'i_1:apply_r1', accel: 'S', run() {} });
  const command = h.bareWatchers[1];

  h.actions.setBareBusy(true);
  for (const w of [reveal, command]) assert.equal(w.busy, true, 'both paths are muted');
  h.actions.setBareBusy(false);
  for (const w of [reveal, command]) assert.equal(w.busy, false);

  h.actions.setBareObserve(true);
  for (const w of [reveal, command]) assert.equal(w.observe, true);
  h.actions.setBareObserve(false);
  for (const w of [reveal, command]) assert.equal(w.observe, false);
});

test('setOption switches mode, position, and auto-dismiss', () => {
  const h = harness({
    shortcuts: Model.normalise({ app: { mode: 'toggle' } }),
  });
  h.actions.apply(h.settings());
  const a = h.actions.setOption({ target: 'app', option: 'mode', value: 'afterPick' });
  assert.equal(a.ok, true);
  assert.equal(h.settings().shortcuts.app.mode, 'afterPick');
  const d = h.actions.setOption({ target: 'app', option: 'autoDismiss', value: true });
  assert.equal(d.ok, true);
  assert.equal(h.settings().shortcuts.app.autoDismiss, true);
  const p = h.actions.setOption({ target: 'palette:p1', option: 'position', value: 'bottom-right' });
  assert.equal(p.ok, true);
  assert.equal(h.settings().shortcuts.palettes.p1.position, 'bottom-right');
  const bad = h.actions.setOption({ target: 'app', option: 'position', value: 'nope' });
  assert.equal(bad.ok, false);
});

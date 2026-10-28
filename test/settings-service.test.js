'use strict';

// The settings service owns settings.json and its side effects.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSettingsService } = require('../src/main/settings-service');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-settings-'));
  return path.join(dir, 'settings.json');
}

function baseHooks(record = []) {
  const noop = () => {};
  return {
    broadcast: (ch) => record.push(['broadcast', ch]),
    normalizeTheme: (t) => t,
    startFollowFocus: () => record.push(['startFollowFocus']),
    stopFollowFocus: () => record.push(['stopFollowFocus']),
    scheduleAutoConnect: () => record.push(['scheduleAutoConnect']),
    applyLocked: (v) => record.push(['applyLocked', v]),
    applyShortcuts: (next) => record.push(['applyShortcuts', next.shortcuts]),
    applySummonHotkey: noop,
    applyCommandHotkeys: noop,
    clearProofCaches: () => record.push(['clearProofCaches']),
    applyLaunchAtLogin: noop,
    applyUiScale: noop,
    applyWindowTheme: noop,
    applyLanguage: noop,
    applyHistoryGate: (v) => record.push(['applyHistoryGate', v]),
  };
}

test('get/set/replace/clear keep the store API', () => {
  const svc = createSettingsService({ file: tmpFile(), defaults: { a: 1 }, hooks: baseHooks() });
  assert.deepEqual(svc.get(), { a: 1 });
  svc.set({ b: 2 });
  assert.deepEqual(svc.get(), { a: 1, b: 2 });
  svc.replace({ c: 3 });
  assert.deepEqual(svc.get(), { c: 3 });
  svc.clear();
  assert.deepEqual(svc.get(), { a: 1 });
});

test('commit runs the side effects a changed setting calls for', () => {
  const calls = [];
  const svc = createSettingsService({
    file: tmpFile(),
    defaults: { autoHide: false, locked: false, historyGate: false },
    hooks: baseHooks(calls),
  });
  svc.commit({ autoHide: true });
  svc.commit({ locked: true });
  svc.commit({ historyGate: true });
  assert.ok(calls.some((c) => c[0] === 'startFollowFocus'));
  assert.ok(calls.some((c) => c[0] === 'applyLocked' && c[1] === true));
  assert.ok(calls.some((c) => c[0] === 'applyHistoryGate' && c[1] === true));
  assert.ok(calls.some((c) => c[0] === 'broadcast' && c[1] === 'settings:changed'));
  assert.equal(svc.get().autoHide, true);
  assert.equal(svc.get().locked, true);
  assert.equal(svc.get().historyGate, true);
});

test('commit re-applies shortcuts when the block changes', () => {
  const calls = [];
  const svc = createSettingsService({
    file: tmpFile(),
    defaults: { shortcuts: { app: { mode: 'toggle', toggle: '', hold: '', autoDismiss: false, position: 'keep' } } },
    hooks: baseHooks(calls),
  });
  svc.commit({ shortcuts: { app: { mode: 'afterPick', toggle: 'Ctrl+Alt+P', hold: '', autoDismiss: false, position: 'keep' } } });
  assert.ok(calls.some((c) => c[0] === 'applyShortcuts'), 'a shortcut change re-registers');
  calls.length = 0;
  svc.commit({ autoHide: false });
  assert.ok(calls.some((c) => c[0] === 'applyShortcuts'), 'Auto-hide still re-applies the holds');
});

test('commit keeps a most-recently-used proof-profile list (max 8)', () => {
  const svc = createSettingsService({ file: tmpFile(), defaults: {}, hooks: baseHooks() });
  svc.commit({ proofProfile: 'b.icc' });
  svc.commit({ proofProfile: 'a.icc' });
  assert.deepEqual(svc.get().proofProfiles, ['a.icc', 'b.icc']);
});

test('commit persists to disk', () => {
  const file = tmpFile();
  const a = createSettingsService({ file, defaults: {}, hooks: baseHooks() });
  a.commit({ theme: 'dark' });
  const b = createSettingsService({ file, defaults: {}, hooks: baseHooks() });
  assert.equal(b.get().theme, 'dark');
});

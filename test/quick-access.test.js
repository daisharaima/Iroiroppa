'use strict';

// Quick Access: the name-addressed read/write pair CSP exposes for its own
// commands (docs/PROTOCOL.md). A selector module reads brush sub-tool flags and
// clicks them through `cspInvoke({ quickAccess })`, so the shapes matter: a wrong
// item ID silently reads as "off", and a NAK resolves like an ACK.

const test = require('node:test');
const assert = require('node:assert/strict');

const QuickAccess = require('../src/main/companion/quick-access');
const { CompanionService } = require('../src/main/service');
const { TYPE } = require('../src/main/companion/packets');

function makeService(client) {
  const settings = { get: () => ({}), set: () => ({}) };
  const session = { get: () => ({}), replace: () => ({}), clear: () => ({}) };
  const svc = new CompanionService({ settings, session });
  if (client) svc.client = client;
  return svc;
}

const item = (name) => ({
  ItemIDType: 'Command', ItemIDCommandType: 'advancedcommand',
  ItemIDCommandName: name, ItemIDToolUuid: '',
});

test('a read builds the UpdateTargetItemIDs CSP expects', () => {
  const detail = QuickAccess.readDetail(['toolpressuretosize', 'toolcompositemultiply']);
  assert.equal(detail.UpdateTargetSetIndex, 0);
  assert.deepEqual(detail.UpdateTargetItemIDs, [item('toolpressuretosize'), item('toolcompositemultiply')]);
});

test('a click names the command as an advancedcommand', () => {
  assert.deepEqual(QuickAccess.clickDetail('toolbrushusewatercolor'), {
    ItemType: 'Command',
    ItemCommandType: 'advancedcommand',
    ItemCommandName: 'toolbrushusewatercolor',
  });
});

test('names are trimmed, de-duplicated, string-only and capped', () => {
  assert.deepEqual(QuickAccess.cleanNames([' a ', 'a', '', 7, null, 'b']), ['a', 'b']);
  const many = Array.from({ length: 100 }, (_, i) => `tool${i}`);
  assert.equal(QuickAccess.cleanNames(many).length, QuickAccess.MAX_NAMES);
  assert.deepEqual(QuickAccess.cleanNames('nope'), []);
});

test('a reply is split into the items that are on and the ones the host disabled', () => {
  const state = QuickAccess.parseState({
    CheckedItemIDs: [item('toolpressuretosize')],
    DisabledItemIDs: [item('toolcompositeerase')],
  });
  assert.deepEqual(state.on, ['toolpressuretosize']);
  assert.deepEqual(state.disabled, ['toolcompositeerase']);
});

test('a reply survives both item shapes and a JSON string', () => {
  assert.deepEqual(
    QuickAccess.parseState({ CheckedItemIDs: [{ ItemCommandName: 'x' }] }).on,
    ['x'],
  );
  assert.deepEqual(
    QuickAccess.parseState(JSON.stringify({ CheckedItemIDs: [item('y')] })).on,
    ['y'],
  );
  // An off item is absent, not false — and a missing/odd payload is "nothing known".
  assert.deepEqual(QuickAccess.parseState(undefined), { on: [], disabled: [] });
  assert.deepEqual(QuickAccess.parseState('{oops'), { on: [], disabled: [] });
  assert.deepEqual(QuickAccess.parseState({}), { on: [], disabled: [] });
});

test('readQuickAccess sends one SyncQuickAccessUIState and reports the flags', async () => {
  const seen = [];
  const svc = makeService({
    alive: true,
    request: async (command, detail) => {
      seen.push({ command, detail });
      return { type: TYPE.SUCCESS, detail: { CheckedItemIDs: [item('toolcompositemultiply')] } };
    },
  });
  const out = await svc.readQuickAccess(['toolcompositemultiply', 'toolpressuretosize']);
  assert.equal(out.ok, true);
  assert.deepEqual(out.on, ['toolcompositemultiply']);
  assert.deepEqual(out.disabled, []);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].command, 'SyncQuickAccessUIState');
  assert.equal(seen[0].detail.UpdateTargetItemIDs.length, 2);
});

test('a NAK is a failure, never "every flag is off"', async () => {
  const svc = makeService({ alive: true, request: async () => ({ type: TYPE.ERROR }) });
  const out = await svc.readQuickAccess(['toolpressuretosize']);
  assert.equal(out.ok, false);
  assert.match(out.error, /rejected/);
  assert.equal(out.on, undefined);
});

test('read/click refuse politely when there is no connection or no input', async () => {
  const offline = makeService(null);
  assert.equal((await offline.readQuickAccess(['a'])).ok, false);
  assert.equal((await offline.clickQuickAccess('a')).ok, false);
  assert.match((await offline.readQuickAccess(['a'])).error, /not connected/);

  const svc = makeService({ alive: true, request: async () => { throw new Error('boom'); } });
  assert.equal((await svc.readQuickAccess([])).error, 'no names');
  assert.equal((await svc.clickQuickAccess('   ')).error, 'no command name');
  const failed = await svc.readQuickAccess(['x']);
  assert.deepEqual(failed, { ok: false, error: 'boom' });
  assert.deepEqual(await svc.clickQuickAccess('x'), { ok: false, error: 'boom' });
});

test('clickQuickAccess clicks a command by name', async () => {
  const seen = [];
  const svc = makeService({
    alive: true,
    request: async (command, detail) => {
      seen.push({ command, detail });
      return { type: TYPE.SUCCESS };
    },
  });
  const out = await svc.clickQuickAccess(' toolbrushusewateredge ');
  assert.deepEqual(out, { ok: true, command: 'toolbrushusewateredge' });
  assert.equal(seen[0].command, 'DoQuickAccess');
  assert.equal(seen[0].detail.ItemCommandName, 'toolbrushusewateredge');
  assert.equal(seen[0].detail.ItemCommandType, 'advancedcommand');
});

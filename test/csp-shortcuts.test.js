'use strict';

// Reading CSP's shortcut files. The files are SQLite;
// the fixture here is one of ours, built with the same `node:sqlite` the reader
// uses, so the parse is exercised end to end without CSP installed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const shortcuts = require('../src/main/csp-shortcuts');

test('describeAccel reads the modifier bitfield', () => {
  assert.equal(shortcuts.describeAccel(4, 'N'), 'Ctrl+N');
  assert.equal(shortcuts.describeAccel(2, 'F2'), 'Shift+F2');
  assert.equal(shortcuts.describeAccel(6, 'S'), 'Ctrl+Shift+S');
  assert.equal(shortcuts.describeAccel(7, 'K'), 'Ctrl+Shift+Alt+K');
  assert.equal(shortcuts.describeAccel(0, 'DELETE'), 'DELETE');
  assert.equal(shortcuts.describeAccel(4, null), '');
  assert.equal(shortcuts.describeAccel(4, 'NULL'), '');
});

test('letterKey maps the 1-based tool index', () => {
  assert.equal(shortcuts.letterKey(1), 'A');
  assert.equal(shortcuts.letterKey(26), 'Z');
  assert.equal(shortcuts.letterKey(0), '');
  assert.equal(shortcuts.letterKey(27), '');
});

test('listCommands parses a shortcutmenu fixture', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-khc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const celsys = path.join(root, 'CELSYS');
  const settings = path.join(celsys, 'CLIPStudioPaintVer1_5_0');
  fs.mkdirSync(path.join(settings, 'Shortcut'), { recursive: true });
  const file = path.join(settings, 'Shortcut', 'default.khc');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE shortcutmenu (menucommandtype TEXT, menucommand TEXT, shortcut TEXT, modifier INTEGER)');
  const ins = db.prepare('INSERT INTO shortcutmenu VALUES (?, ?, ?, ?)');
  ins.run('t', 'File.New', 'N', 4);
  ins.run('t', 'File.SaveAs', 'S', 6);
  ins.run('t', 'Edit.Undo', 'NULL', 0);
  db.close();

  const cmds = shortcuts.listCommands(settings);
  assert.equal(cmds.length, 3);
  assert.equal(cmds[0].command, 'File.New');
  assert.equal(cmds[0].accel, 'Ctrl+N');
  assert.deepEqual(cmds[0].accels, ['Ctrl+N']);
  assert.equal(cmds[0].modifier, 4);
  assert.equal(cmds[0].shortcut, 'N');
  assert.equal(cmds[0].raw, 'File.New');
  assert.ok(cmds[0].label);
  assert.equal(cmds[1].accel, 'Ctrl+Shift+S');
  assert.equal(cmds[2].accel, '', 'NULL is unbound');
  assert.ok(cmds[2].label, 'every command has a display label');

  const all = shortcuts.list({ documents: root });
  assert.equal(all.ok, true);
  assert.equal(all.commands.length, 3);
});

test('list reports a missing install instead of throwing', () => {
  const res = shortcuts.list({ documents: path.join(os.tmpdir(), 'iro-missing-xyz') });
  assert.equal(res.ok, false);
  assert.match(res.reason, /not found/);
  assert.deepEqual(res.commands, []);
});

test('listCommands reads only the current workspace, never another one', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iro-ws-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const celsys = path.join(root, 'CELSYS');
  const settings = path.join(celsys, 'CLIPStudioPaintVer1_5_0');
  const wsDir = path.join(settings, 'WorkSpace');
  fs.mkdirSync(path.join(settings, 'Shortcut'), { recursive: true });
  fs.mkdirSync(wsDir, { recursive: true });

  const defaultDb = new DatabaseSync(path.join(settings, 'Shortcut', 'default.khc'));
  defaultDb.exec('CREATE TABLE shortcutmenu (menucommandtype TEXT, menucommand TEXT, shortcut TEXT, modifier INTEGER)');
  defaultDb.prepare('INSERT INTO shortcutmenu VALUES (?, ?, ?, ?)').run('t', 'filenew', 'N', 4);
  defaultDb.close();

  const currentFile = path.join(wsDir, 'workspace_C.spws');
  const current = new DatabaseSync(currentFile);
  current.exec('CREATE TABLE workspaceshortcutmenu (menucommandtype TEXT, menucommand TEXT, shortcut TEXT, modifier INTEGER)');
  current.prepare('INSERT INTO workspaceshortcutmenu VALUES (?, ?, ?, ?)').run('t', 'filenew', 'N', 6);
  current.exec('CREATE TABLE workspacetoolbaritem (command TEXT, name TEXT)');
  current.prepare('INSERT INTO workspacetoolbaritem VALUES (?, ?)').run('filenew', 'New (current)');
  current.exec('CREATE TABLE workspaceshortcuttool (shortcut TEXT, uuid BLOB)');
  current.close();

  const otherFile = path.join(wsDir, 'workspace_OLD.spws');
  const other = new DatabaseSync(otherFile);
  other.exec('CREATE TABLE workspaceshortcutmenu (menucommandtype TEXT, menucommand TEXT, shortcut TEXT, modifier INTEGER)');
  other.prepare('INSERT INTO workspaceshortcutmenu VALUES (?, ?, ?, ?)').run('t', 'fileopen', 'O', 4);
  other.close();

  const info = new DatabaseSync(path.join(wsDir, 'workspacelistinfo.spwi'));
  info.exec('CREATE TABLE workspacecurrent (workspacecurrentfilename TEXT, workspacecurrentname TEXT)');
  info.prepare('INSERT INTO workspacecurrent VALUES (?, ?)').run('workspace_C.spws', 'Current');
  info.close();

  const cmds = shortcuts.listCommands(settings);
  assert.equal(cmds.length, 1, 'default-only and other-workspace rows are not merged in');
  assert.equal(cmds[0].command, 'filenew');
  assert.deepEqual(cmds[0].accels, ['Ctrl+Shift+N']);
  assert.equal(cmds[0].label, 'New (current)', 'labels come from the current workspace');

  const all = shortcuts.list({ documents: root });
  assert.equal(all.workspace.file, 'workspace_C.spws');
  assert.ok(all.workspace.savedAt, 'the source timestamp is reported');
  assert.equal(all.workspace.commandCount, 1);
});

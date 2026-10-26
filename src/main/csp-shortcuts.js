'use strict';

// Read CSP's shortcut configuration (; the file layout is
// in docs/ARCHITECTURE.md, "CSP shortcut storage"). Everything here is read-only —
// the app never writes CSP's files.
//
// The files are SQLite and Node's built-in `node:sqlite` reads them with no new
// dependency. CSP's user-settings root (the "materials location") is either the
// default `<Documents>\CELSYS` or a custom path in
// `CLIPStudioCommon\Preference\Config.sqlite` -> CategoryFolderPath.DataFolderPath;
// under it, `CLIPStudioPaintVer1_5_0\` holds the shortcut files.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { commandName } = require('../shared/csp-command-names');

const VERSION_DIR = /^CLIPStudioPaintVer/;

/** `modifier` is a Windows-style bitfield (4=Ctrl, 2=Shift, 1=Alt); `shortcut` a key. */
function describeAccel(modifier, shortcut) {
  const key = shortcut == null ? '' : String(shortcut).trim();
  if (!key || key.toUpperCase() === 'NULL') return '';
  const bits = Number(modifier) || 0;
  const mods = [];
  if (bits & 4) mods.push('Ctrl');
  if (bits & 2) mods.push('Shift');
  if (bits & 1) mods.push('Alt');
  return mods.length ? `${mods.join('+')}+${key}` : key;
}

/** A tool key is a 1-based letter index (1=A … 26=Z); anything else is ''. */
function letterKey(n) {
  const i = Number(n);
  return Number.isInteger(i) && i >= 1 && i <= 26 ? String.fromCharCode(64 + i) : '';
}

/** `<home>\Documents` — CSP's default materials root's parent. */
function defaultDocuments({ homedir = os.homedir(), env = process.env } = {}) {
  const base = env.USERPROFILE || homedir;
  return path.join(base, 'Documents');
}

/** Read one row from `file`, or null (a missing/corrupt file is not an error). */
function readRow(file, sql, params = [], { exists = fs.existsSync, DatabaseSync } = {}) {
  if (!exists(file)) return null;
  const DB = DatabaseSync || require('node:sqlite').DatabaseSync;
  let db;
  try {
    db = new DB(file, { readOnly: true });
    return db.prepare(sql).get(...params) || null;
  } catch {
    return null;
  } finally {
    try { if (db) db.close(); } catch { /* ignore */ }
  }
}

function readRows(file, sql, params = [], { exists = fs.existsSync, DatabaseSync } = {}) {
  if (!exists(file)) return [];
  const DB = DatabaseSync || require('node:sqlite').DatabaseSync;
  let db;
  try {
    db = new DB(file, { readOnly: true });
    return db.prepare(sql).all(...params) || [];
  } catch {
    return [];
  } finally {
    try { if (db) db.close(); } catch { /* ignore */ }
  }
}

/** The CSP user-settings root (`...\CELSYS`), or '' when it cannot be found. */
function resolveRoot({ documents = defaultDocuments(), exists = fs.existsSync, DatabaseSync } = {}) {
  const celsys = path.join(documents, 'CELSYS');
  const custom = readRow(
    path.join(celsys, 'CLIPStudioCommon', 'Preference', 'Config.sqlite'),
    'SELECT DataFolderPath FROM CategoryFolderPath LIMIT 1',
    [],
    { exists, DatabaseSync },
  );
  const customPath = custom && custom.DataFolderPath ? String(custom.DataFolderPath) : '';
  if (customPath && exists(customPath)) return customPath;
  return exists(celsys) ? celsys : '';
}

/** The versioned folder under the materials root (`CLIPStudioPaintVer1_5_0`). */
function settingsRoot(root, { exists = fs.existsSync, readdir = fs.readdirSync } = {}) {  if (!root || !exists(root)) return '';
  try {
    // A materials root can hold several versions (1_1_0 beside 1_5_0). The
    // newest is the one CSP is running; picking the first readdir entry read the
    // old install and found no current workspace.
    const score = (name) => {
      const m = String(name).match(/Ver(\d+)_(\d+)_(\d+)/i);
      return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : -1;
    };
    const dir = readdir(root)
      .filter((d) => VERSION_DIR.test(d))
      .sort((a, b) => score(b) - score(a))[0];
    return dir ? path.join(root, dir) : '';
  } catch {
    return '';
  }
}

/**
 * The current workspace (`.spws`), where CSP keeps its effective shortcut set.
 * `workspacelistinfo.spwi` names the current file; `workspacelist.txt` is the
 * fallback for an older layout.
 */
function readWorkspace(settings, deps = {}) {
  const dir = path.join(settings, 'WorkSpace');
  const row = readRow(
    path.join(dir, 'workspacelistinfo.spwi'),
    'SELECT workspacecurrentfilename, workspacecurrentname FROM workspacecurrent LIMIT 1',
    [],
    deps,
  );
  let file = row && row.workspacecurrentfilename ? String(row.workspacecurrentfilename) : '';
  let name = row && row.workspacecurrentname ? String(row.workspacecurrentname) : '';
  if (!file) {
    try {
      const raw = fs.readFileSync(path.join(dir, 'workspacelist.txt'), 'utf8');
      const match = raw.match(/workspace_[^\s"']+\.spws/i);
      if (match) file = match[0];
    } catch { /* no workspace list */ }
  }
  if (!file) return { file: '', name: '', path: '' };
  const full = path.join(dir, file);
  const exists = deps.exists || fs.existsSync;
  if (!exists(full)) return { file, name, path: '' };
  return { file, name, path: full };
}

/** Command -> localized label from the current workspace's toolbar items. */
function readCommandLabels(workspace, deps = {}) {
  const labels = new Map();
  if (!workspace || !workspace.path) return labels;
  for (const r of readRows(workspace.path,
    "SELECT command, name FROM workspacetoolbaritem WHERE command IS NOT NULL AND name IS NOT NULL AND name <> ''",
    [], deps)) {
    const id = String(r.command || '');
    if (id && !labels.has(id)) labels.set(id, String(r.name));
  }
  return labels;
}

/** Merge duplicate rows for one command into one entry with all its accelerators. */
function mergeCommandRows(rows) {
  const out = new Map();
  for (const r of rows) {
    const command = r.menucommand == null ? '' : String(r.menucommand);
    if (!command) continue;
    const accel = describeAccel(r.modifier, r.shortcut);
    const entry = out.get(command) || { command, accels: [], modifier: 0, shortcut: '' };
    if (accel && !entry.accels.includes(accel)) entry.accels.push(accel);
    if (!entry.shortcut && r.shortcut != null && String(r.shortcut).toUpperCase() !== 'NULL') {
      entry.shortcut = String(r.shortcut);
      entry.modifier = Number(r.modifier) || 0;
    }
    out.set(command, entry);
  }
  return out;
}

/** CSP's command shortcuts: `[{ command, label, accels, raw }]`. */
function listCommands(settings, deps = {}) {
  const workspace = readWorkspace(settings, deps);
  const read = (file, sql) => readRows(file, sql, [], deps);
  const wsMap = workspace.path
    ? mergeCommandRows(read(workspace.path, 'SELECT menucommand, shortcut, modifier FROM workspaceshortcutmenu'))
    : new Map();
  // The current workspace is authoritative. Do not merge the factory/global
  // table into it: that is how old shortcuts from another context used to
  // reappear. Only a workspace without a shortcut table falls back to
  // default.khc.
  const source = wsMap.size
    ? wsMap
    : mergeCommandRows(read(path.join(settings, 'Shortcut', 'default.khc'),
      'SELECT menucommand, shortcut, modifier FROM shortcutmenu'));
  const labels = readCommandLabels(workspace, deps);
  return [...source.values()].map((c) => ({
    command: c.command,
    label: commandName(c.command, labels.get(c.command)),
    accels: c.accels,
    accel: c.accels[0] || '',
    modifier: c.modifier,
    shortcut: c.shortcut,
    raw: c.command,
  }));
}

/** Tool/subtool and brush keys from CSP's Node databases. */
function listToolShortcuts(settings, deps = {}) {
  const sources = [
    { file: path.join(settings, 'Tool', 'EditImageTool.todb'), kind: 'tool' },
    { file: path.join(settings, 'BrushPreset', 'BrushPreset.bfps'), kind: 'brush' },
    { file: path.join(settings, 'MixPalette', 'MixPaletteTool.todb'), kind: 'tool' },
  ];
  const byUuid = new Map();
  const legacy = [];
  for (const source of sources) {
    const rows = readRows(source.file, 'SELECT NodeUuid, NodeName, NodeShortCutKey FROM Node', [], deps);
    for (const r of rows) {
      const name = String(r.NodeName || '');
      if (r.NodeUuid && name) byUuid.set(Buffer.from(r.NodeUuid).toString('hex'), { name, kind: source.kind });
      const key = letterKey(r.NodeShortCutKey);
      if (name && key) legacy.push({ name, key, kind: source.kind });
    }
  }
  // The current workspace's tool shortcuts are the effective ones. Their uuid is
  // a Blob matching Node.NodeUuid; the shortcut is a key string (e.g. "Z").
  const workspace = readWorkspace(settings, deps);
  const wsTools = workspace.path
    ? readRows(workspace.path, 'SELECT shortcut, uuid FROM workspaceshortcuttool', [], deps)
      .map((r) => {
        const key = r.shortcut == null ? '' : String(r.shortcut);
        const uuid = r.uuid ? Buffer.from(r.uuid).toString('hex') : '';
        const hit = byUuid.get(uuid) || { name: '', kind: 'tool' };
        return {
          name: hit.name, key: key && key.toUpperCase() !== 'NULL' ? key : '',
          kind: hit.kind, uuid,
        };
      })
      .filter((t) => t.name && t.key)
    : [];
  const seen = new Set();
  return [...wsTools, ...legacy].filter((t) => {
    const k = `${t.kind}\u0000${t.name}\u0000${t.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function workspaceMeta(workspace, deps = {}) {
  const out = { ...workspace, savedAt: '', savedMs: 0 };
  if (!workspace || !workspace.path) return out;
  try {
    const stat = (deps.stat || fs.statSync)(workspace.path);
    out.savedMs = Number(stat.mtimeMs) || 0;
    out.savedAt = out.savedMs ? new Date(out.savedMs).toISOString() : '';
  } catch { /* the file vanished between resolve and stat */ }
  return out;
}

/**
 * Resolve the CSP settings folder, honouring an explicit pick from the settings.
 * The pick may be the CELSYS materials root (contains `CLIPStudioPaintVer…`) or
 * the version folder itself; anything else is reported as invalid rather than
 * silently falling back, so the row can explain what it expects.
 */
function resolveFolder(chosen, { documents, ...deps } = {}) {
  const exists = deps.exists || fs.existsSync;
  if (!chosen) {
    const root = resolveRoot({ documents, ...deps });
    return { root, settings: settingsRoot(root, deps), override: false, invalid: false };
  }
  const dir = String(chosen);
  if (!exists(dir)) return { root: dir, settings: '', override: true, invalid: true };
  const direct = settingsRoot(dir, deps);
  if (direct) return { root: dir, settings: direct, override: true, invalid: false };
  if (VERSION_DIR.test(path.basename(dir))) {
    return { root: path.dirname(dir), settings: dir, override: true, invalid: false };
  }
  return { root: dir, settings: '', override: true, invalid: true };
}

/**
 * Everything the module needs in one call.
 * @returns {{ok:boolean, root:string, settings:string, reason:string, commands:Array, tools:Array}}
 */
function list({ root: chosenRoot, documents, ...deps } = {}) {
  const resolved = resolveFolder(chosenRoot, { documents, ...deps });
  const root = resolved.root;
  const settings = resolved.settings;
  if (!settings) {
    const expected = 'the CELSYS folder (it contains CLIPStudioPaintVer…) or a CLIPStudioPaintVer… folder';
    return {
      ok: false, root, settings: '', override: Boolean(chosenRoot), invalid: resolved.invalid,
      workspace: { file: '', name: '', path: '', savedAt: '', savedMs: 0 },
      reason: chosenRoot
        ? `CSP settings not found in ${root} — choose ${expected}.`
        : `CSP settings not found at ${path.join(documents || '', 'CELSYS')}`,
      commands: [], tools: [],
    };
  }
  const workspace = workspaceMeta(readWorkspace(settings, deps), deps);
  const commands = listCommands(settings, deps);
  const tools = listToolShortcuts(settings, deps);
  return {
    ok: true,
    root,
    settings,
    workspace: { ...workspace, commandCount: commands.length, toolCount: tools.length },
    reason: commands.length || tools.length
      ? ''
      : `No shortcuts found under ${path.join(settings, 'Shortcut')}`,
    commands,
    tools,
  };
}

module.exports = {
  describeAccel,
  letterKey,
  defaultDocuments,
  resolveRoot,
  resolveFolder,
  settingsRoot,
  listCommands,
  listToolShortcuts,
  list,
};

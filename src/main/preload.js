'use strict';

// Bridge between the sandboxed renderer and the main process.

const { contextBridge, ipcRenderer } = require('electron');

// The user modules (docs/USER-MODULES.md), passed by main as a window argument so
// the renderer has them before it builds the board — with no IPC round trip. A
// synchronous IPC here could freeze a window if the main handler were missing
// (e.g. a stale main process), which showed up as a blank Settings window.
const USER_MODULES = (() => {
  const prefix = '--user-modules=';
  const arg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith(prefix));
  if (!arg) return [];
  try {
    const list = JSON.parse(arg.slice(prefix.length));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
})();

// Which state path the renderer uses (docs/STATE.md). `model` consumes the canonical
// model through `onStateChanged`; `legacy` keeps the per-domain channels. Main
// defaults to `legacy` until the model path has passed a live check.
const STATE_MODE = (() => {
  const prefix = '--state-mode=';
  const arg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : 'legacy';
})();

// The window's own palette id (plan: palette equality). Every palette window and float
// is told which palette it renders, so it never has to assume it is "the primary".
const PALETTE_ID = (() => {
  const prefix = '--palette-id=';
  const arg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
})();

contextBridge.exposeInMainWorld('csp', {
  snapshot: () => ipcRenderer.invoke('app:snapshot'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  capabilities: () => ipcRenderer.invoke('capabilities:get'),
  captureSources: () => ipcRenderer.invoke('capture:sources'),
  cspShortcuts: () => ipcRenderer.invoke('csp:shortcuts'),
  i18nLocales: () => ipcRenderer.invoke('i18n:locales'),
  cspInvoke: (spec) => ipcRenderer.invoke('csp:invoke', spec),
  onCapabilities: (fn) => {
    const h = (_e, s) => fn(s);
    ipcRenderer.on('capabilities:changed', h);
    return () => ipcRenderer.removeListener('capabilities:changed', h);
  },

  // The canonical state layer (docs/STATE.md, §12). `stateMode` is read from the
  // window arguments, so the renderer knows which path to consume without a round
  // trip. One listener per channel keeps the IPC-listener budget low.
  stateMode: STATE_MODE,
  paletteId: PALETTE_ID,
  onStateChanged: (fn) => {
    const h = (_e, change) => fn(change);
    ipcRenderer.on('state:changed', h);
    return () => ipcRenderer.removeListener('state:changed', h);
  },
  stateSnapshot: () => ipcRenderer.invoke('state:get'),
  intent: (name, payload) => ipcRenderer.invoke('state:intent', { name, payload }),
  onPeerEvent: (fn) => {
    const h = (_e, evt) => fn(evt);
    ipcRenderer.on('peer:event', h);
    return () => ipcRenderer.removeListener('peer:event', h);
  },
  onPeerPeers: (fn) => {
    const h = (_e, peers) => fn(peers);
    ipcRenderer.on('peer:peers', h);
    return () => ipcRenderer.removeListener('peer:peers', h);
  },
  peerHello: (meta) => ipcRenderer.send('peer:hello', meta),
  onPeerPort: (fn) => {
    ipcRenderer.on('peer:port', (e) => { if (e.ports && e.ports[0]) fn(e.ports[0]); });
  },

  pair: () => ipcRenderer.invoke('companion:pair'),
  pairWithPayload: (payload) => ipcRenderer.invoke('companion:pairWithPayload', payload),
  cancelScan: () => ipcRenderer.invoke('companion:cancelScan'),
  reconnect: () => ipcRenderer.invoke('companion:reconnect'),
  disconnect: (forget = false) => ipcRenderer.invoke('companion:disconnect', { forget }),
  selectSlot: (slot) => ipcRenderer.invoke('companion:selectSlot', slot),
  getProof: () => ipcRenderer.invoke('proof:get'),
  listProofProfiles: (refresh = false) => ipcRenderer.invoke('proof:list', { refresh }),
  browseProofProfile: () => ipcRenderer.invoke('proof:browse'),
  listThemes: () => ipcRenderer.invoke('themes:list'),
  getModuleSettings: (id, fallbackId) => ipcRenderer.invoke('modules:get', id, fallbackId),
  saveModuleSettings: (id, settings, version, moduleId) => ipcRenderer.invoke('modules:set', { id, settings, version, moduleId }),
  listModuleIds: () => ipcRenderer.invoke('modules:list'),
  userModules: () => USER_MODULES,
  listTrash: () => ipcRenderer.invoke('modules:trash'),
  purgeTrash: () => ipcRenderer.invoke('modules:purge'),
  trashPreview: (id) => ipcRenderer.invoke('modules:trash:preview', { id }),
  trashRestore: (id) => ipcRenderer.invoke('modules:trash:restore', { id }),
  getLayout: () => ipcRenderer.invoke('layout:get'),
  // The window's own palette columns (plan: palette equality) — no id in the payload.
  getPaletteColumns: () => ipcRenderer.invoke('palette:columns:get'),
  setPaletteColumns: (columns) => ipcRenderer.send('palette:columns:set', columns),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  saveLayout: (layout) => ipcRenderer.invoke('layout:set', layout),
  floatsList: () => ipcRenderer.invoke('floats:list'),
  floatRemove: (floatId) => ipcRenderer.send('float:remove', { floatId }),
  floatDock: (spec) => ipcRenderer.send('float:dock', spec),
  windowBounds: () => ipcRenderer.invoke('window:bounds'),
  // `floatAdd`, `moduleHover` and `moduleDrop` are gone: a drop is a `layout.place`
  // intent now and the resolver decides the target (docs/LAYOUT.md, V6).
  getHistory: () => ipcRenderer.invoke('history:get'),
  pushHistory: (rgb) => ipcRenderer.send('history:add', rgb),
  floatRemoveModule: (moduleId) => ipcRenderer.send('float:remove-module', { moduleId }),
  dragOverlay: (spec) => ipcRenderer.send('drag:overlay', spec),
  // The palette menu, drawn by the overlay window so it can leave the palette's own window.
  showPaletteMenu: (spec) => ipcRenderer.send('palette:menu', spec),
  onPaletteMenuPick: (cb) => ipcRenderer.on('palette:menu:pick', (_e, d) => cb(d)),
  overlayMenuPick: (index) => ipcRenderer.send('overlay:menu:pick', { index }),
  overlayMenuClose: () => ipcRenderer.send('overlay:menu:close'),
  onOverlayMenu: (cb) => ipcRenderer.on('overlay:menu', (_e, d) => cb(d)),
  boardMetrics: (metrics) => ipcRenderer.send('board:metrics', metrics),
  dragBegin: (payload) => ipcRenderer.send('drag:begin', payload),
  dragDrop: () => ipcRenderer.invoke('drag:drop'),
  dragCancel: () => ipcRenderer.send('drag:cancel'),
  dragPlace: (payload) => ipcRenderer.invoke('drag:place', payload),
  duplicatePalette: (paletteId) => ipcRenderer.invoke('palette:duplicate', paletteId),  listPalettes: () => ipcRenderer.invoke('workspace:palettes'),
  exportPalette: (spec) => ipcRenderer.invoke('palette:export', spec),
  importPalette: (spec) => ipcRenderer.invoke('palette:import', spec),
  addModule: (moduleId) => ipcRenderer.invoke('module:add', { moduleId }),
  setModuleHeight: (instanceId, height) => ipcRenderer.invoke('module:setHeight', { instanceId, height }),
  duplicateModule: (instanceId) => ipcRenderer.invoke('module:duplicate', { instanceId }),
  hideModule: (instanceId) => ipcRenderer.invoke('module:hide', { instanceId }),
  showModule: (instanceId) => ipcRenderer.invoke('module:show', { instanceId }),
  removeModule: (instanceId) => ipcRenderer.invoke('module:remove', { instanceId }),
  listHidden: () => ipcRenderer.invoke('workspace:hidden'),
  renamePaletteById: (spec) => ipcRenderer.invoke('palette:rename', spec),
  exportWorkspace: (spec) => ipcRenderer.invoke('workspace:export', spec),
  importWorkspace: (spec) => ipcRenderer.invoke('workspace:import', spec),
  namedWorkspaces: () => ipcRenderer.invoke('workspace:names'),
  saveNamedWorkspace: (name) => ipcRenderer.invoke('workspace:saveNamed', { name }),
  loadNamedWorkspace: (id) => ipcRenderer.invoke('workspace:loadNamed', { id }),
  renameNamedWorkspace: (id, name) => ipcRenderer.invoke('workspace:renameNamed', { id, name }),
  deleteNamedWorkspace: (id) => ipcRenderer.invoke('workspace:deleteNamed', { id }),
  exportSettings: (spec) => ipcRenderer.invoke('settings:export', spec),
  importSettings: (spec) => ipcRenderer.invoke('settings:import', spec),
  openModuleSettings: (spec) => ipcRenderer.invoke('moduleSettings:open', spec),
  closeModuleSettings: () => ipcRenderer.send('moduleSettings:close'),
  resizeModuleSettings: (height) => ipcRenderer.send('moduleSettings:resize', { height }),
  requestModuleAction: (payload) => ipcRenderer.send('module:action', payload),

  // The module command bus (docs/MODULES.md, "Module commands").
  commandRegister: (table) => ipcRenderer.send('module:command:register', table),
  commandCall: (target, command, args) => ipcRenderer.invoke('module:command:call', { target, command, args }),
  commandResult: (callId, ok, value, error) => ipcRenderer.send('module:command:result', { callId, ok, value, error }),
  listCommands: () => ipcRenderer.invoke('module:commands:list'),
  onCommandInvoke: (cb) => ipcRenderer.on('module:command:invoke', (_e, d) => cb(d)),

  writeColor: (rgb, immediate = false) =>
    ipcRenderer.send('color:write', { r: rgb.r, g: rgb.g, b: rgb.b, immediate }),

  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  setSummonHotkey: (accel) => ipcRenderer.invoke('shortcut:setSummon', accel),
  shortcutCatalog: () => ipcRenderer.invoke('shortcut:catalog'),
  setCommandBinding: (key, accel) => ipcRenderer.invoke('shortcut:setBinding', { key, accel }),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),

  hide: () => ipcRenderer.send('window:hide'),
  moveBy: (dx, dy) => ipcRenderer.send('window:move-by', { dx, dy }),
  moveSelfBy: (dx, dy) => ipcRenderer.send('window:move-by-self', { dx, dy }),
  setCollapsed: (on, height) => ipcRenderer.send('window:collapsed', { on, height }),
  setEditable: (on) => ipcRenderer.send('window:editable', on),
  resize: (width, height) => ipcRenderer.send('window:resize', { width, height }),
  resizeSelf: (width, height) => ipcRenderer.send('window:resize-self', { width, height }),
  setMinSizeSelf: (width, height) => ipcRenderer.send('window:min-size-self', { width, height }),
  setResizableSelf: (on) => ipcRenderer.send('window:set-resizable-self', { resizable: on }),
  floatCollapsed: (floatId, collapsed) => ipcRenderer.send('float:collapsed', { floatId, collapsed }),
  openSettings: () => ipcRenderer.send('settings:open'),
  closeSettings: () => ipcRenderer.send('settings:close'),
  resizeSettings: (height) => ipcRenderer.send('settings:resize', { height }),
  setSettingsMinWidth: (width) => ipcRenderer.invoke('settings:min-width', { width }),
  quit: () => ipcRenderer.send('app:quit'),

  onStatus: (cb) => ipcRenderer.on('companion:status', (_e, s) => cb(s)),
  onColor: (cb) => ipcRenderer.on('companion:color', (_e, c) => cb(c)),
  onSettings: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
  onUpdate: (cb) => ipcRenderer.on('update:changed', (_e, info) => cb(info)),
  onLayoutChanged: (cb) => ipcRenderer.on('layout:changed', (_e, layout) => cb(layout)),
  onHistoryChanged: (cb) => ipcRenderer.on('history:changed', (_e, list) => cb(list)),
  paletteState: () => ipcRenderer.invoke('palette:state:get'),
  unsnapPalette: () => ipcRenderer.invoke('palette:unsnap'),
  deletePalette: () => ipcRenderer.invoke('palette:delete'),
  deletePaletteById: (paletteId) => ipcRenderer.invoke('palette:delete', { paletteId }),
  renamePalette: (name) => ipcRenderer.invoke('palette:rename', name),
  onOverlay: (cb) => ipcRenderer.on('overlay:update', (_e, d) => cb(d)),
  /** How many IPC listeners this renderer is holding — a leak here is what produced
   *  "MaxListenersExceededWarning: 11 companion:status listeners" (dev flag `--listeners`). */
  listenerCounts: () => ({
    status: ipcRenderer.listenerCount('companion:status'),
    settings: ipcRenderer.listenerCount('settings:changed'),
    color: ipcRenderer.listenerCount('companion:color'),
    layout: ipcRenderer.listenerCount('layout:changed'),
  }),
  onModuleChanged: (cb) => ipcRenderer.on('module:changed', (_e, d) => cb(d)),
  onModuleAction: (cb) => ipcRenderer.on('module:action', (_e, p) => cb(p)),
});

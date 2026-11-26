'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const USER_MODULES = (() => {
  const prefix = '--user-modules=';
  const arg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith(prefix));
  if (!arg) return [];
  try {
    const list = JSON.parse(arg.slice(prefix.length));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
})();

const STATE_MODE = (() => {
  const prefix = '--state-mode=';
  const arg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : 'legacy';
})();

const HOLD_INTERACTION = (process.argv || []).includes('--hold-interaction=1');

const PALETTE_ID = (() => {
  const prefix = '--palette-id=';
  const arg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
})();

contextBridge.exposeInMainWorld('csp', {
  snapshot: () => ipcRenderer.invoke('app:snapshot'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  getAbout: () => ipcRenderer.invoke('app:about'),
  aboutText: (name) => ipcRenderer.invoke('about:text', name),
  openAboutFile: (name) => ipcRenderer.invoke('about:open', name),
  getWhatsNew: () => ipcRenderer.invoke('whats-new:get'),
  markWhatsNewSeen: () => ipcRenderer.invoke('whats-new:seen'),
  openWhatsNew: () => ipcRenderer.invoke('whats-new:open'),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  capabilities: () => ipcRenderer.invoke('capabilities:get'),
  captureSources: () => ipcRenderer.invoke('capture:sources'),
  cspShortcuts: () => ipcRenderer.invoke('csp:shortcuts'),

  watchQuickAccess: (names) => ipcRenderer.invoke('csp:watch', names),
  unwatchQuickAccess: () => ipcRenderer.invoke('csp:unwatch'),
  quickAccessState: () => ipcRenderer.invoke('csp:quickState'),
  onQuickAccessState: (fn) => {
    ipcRenderer.on('csp:quickState', (e, snap) => fn(snap));
  },
  i18nLocales: () => ipcRenderer.invoke('i18n:locales'),
  cspInvoke: (spec) => ipcRenderer.invoke('csp:invoke', spec),
  onCapabilities: (fn) => {
    const h = (_e, s) => fn(s);
    ipcRenderer.on('capabilities:changed', h);
    return () => ipcRenderer.removeListener('capabilities:changed', h);
  },

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
  resolveCspRoot: (root) => ipcRenderer.invoke('shortcut:resolve', root),
  browseCspRoot: (current) => ipcRenderer.invoke('shortcut:browseRoot', current),
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

  getPaletteColumns: () => ipcRenderer.invoke('palette:columns:get'),
  setPaletteColumns: (columns) => ipcRenderer.send('palette:columns:set', columns),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  saveLayout: (layout) => ipcRenderer.invoke('layout:set', layout),
  floatsList: () => ipcRenderer.invoke('floats:list'),
  floatRemove: (floatId) => ipcRenderer.send('float:remove', { floatId }),
  floatDock: (spec) => ipcRenderer.send('float:dock', spec),
  windowBounds: () => ipcRenderer.invoke('window:bounds'),

  getHistory: () => ipcRenderer.invoke('history:get'),
  pushHistory: (rgb) => ipcRenderer.send('history:add', rgb),
  floatRemoveModule: (moduleId) => ipcRenderer.send('float:remove-module', { moduleId }),
  dragOverlay: (spec) => ipcRenderer.send('drag:overlay', spec),

  showPaletteMenu: (spec) => ipcRenderer.send('palette:menu', spec),
  onPaletteMenuPick: (cb) => ipcRenderer.on('palette:menu:pick', (_e, d) => cb(d)),
  overlayMenuPick: (index) => ipcRenderer.send('overlay:menu:pick', { index }),
  overlayMenuClose: () => ipcRenderer.send('overlay:menu:close'),
  onOverlayMenu: (cb) => ipcRenderer.on('overlay:menu', (_e, d) => cb(d)),
  onOverlayConfirm: (cb) => ipcRenderer.on('overlay:confirm', (_e, d) => cb(d)),
  overlayConfirmPick: (ok) => ipcRenderer.send('overlay:confirm:pick', { ok: ok === true }),
  tooltipShow: (spec) => ipcRenderer.send('tooltip:show', spec),
  tooltipHide: () => ipcRenderer.send('tooltip:hide'),
  uiTyping: (on) => ipcRenderer.send('ui:typing', Boolean(on)),
  onOverlayTooltip: (cb) => ipcRenderer.on('overlay:tooltip', (_e, d) => cb(d)),
  closeModuleSettings: () => ipcRenderer.send('module-settings:close'),
  onInputReset: (cb) => ipcRenderer.on('input:reset', () => cb()),

  inputTrace: (rec) => ipcRenderer.send('input:trace', rec),

  inputPress: () => ipcRenderer.send('input:press'),
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

  openLens: (spec) => ipcRenderer.invoke('lens:open', spec),
  closeLens: () => ipcRenderer.send('lens:close'),
  resizeLens: (height) => ipcRenderer.send('lens:resize', { height }),
  setLens: (instanceId, lens) => ipcRenderer.send('lens:set', { instanceId, lens }),
  onLensApply: (cb) => ipcRenderer.on('lens:apply', (_e, d) => cb(d)),
  requestModuleAction: (payload) => ipcRenderer.send('module:action', payload),

  commandRegister: (table) => ipcRenderer.send('module:command:register', table),
  commandCall: (target, command, args) => ipcRenderer.invoke('module:command:call', { target, command, args }),
  commandResult: (callId, ok, value, error) => ipcRenderer.send('module:command:result', { callId, ok, value, error }),
  listCommands: () => ipcRenderer.invoke('module:commands:list'),
  onCommandInvoke: (cb) => ipcRenderer.on('module:command:invoke', (_e, d) => cb(d)),

  writeColor: (rgb, immediate = false) =>
    ipcRenderer.send('color:write', { r: rgb.r, g: rgb.g, b: rgb.b, immediate }),
  previewColor: (lab, active) =>
    ipcRenderer.send('color:preview', { L: lab.L, a: lab.a, b: lab.b, active }),

  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  setSummonHotkey: (accel) => ipcRenderer.invoke('shortcut:setSummon', accel),
  shortcutCatalog: () => ipcRenderer.invoke('shortcut:catalog'),
  setCommandBinding: (key, accel) => ipcRenderer.invoke('shortcut:setBinding', { key, accel }),
  setShortcut: (spec) => ipcRenderer.invoke('shortcut:set', spec),
  setShortcutOption: (spec) => ipcRenderer.invoke('shortcut:setOption', spec),
  setAltClick: (target) => ipcRenderer.invoke('shortcut:setAltClick', { target }),
  setModuleCollapsed: (instanceId, collapsed) => ipcRenderer.invoke('module:setCollapsed', { instanceId, collapsed }),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),

  hide: () => ipcRenderer.send('window:hide'),
  moveBy: (dx, dy) => ipcRenderer.send('window:move-by', { dx, dy }),
  moveSelfBy: (dx, dy) => ipcRenderer.send('window:move-by-self', { dx, dy }),
  setCollapsed: (on, height) => ipcRenderer.send('window:collapsed', { on, height }),
  setEditable: (on) => ipcRenderer.send('window:editable', on),
  setEditableSelf: (on) => ipcRenderer.send('window:editable-self', on),
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

  onHelpersState: (cb) => ipcRenderer.on('helpers:state', (_e, s) => cb(s)),
  helpersState: () => ipcRenderer.invoke('helpers:get'),
  onColor: (cb) => ipcRenderer.on('companion:color', (_e, c) => cb(c)),
  onColorPreview: (cb) => ipcRenderer.on('companion:color-preview', (_e, c) => cb(c)),

  localFirst: (process.argv || []).includes('--local-first=1'),
  holdInteraction: HOLD_INTERACTION,
  interactionBegin: (spec) => ipcRenderer.invoke('interaction:begin', spec),
  interactionUpdate: (spec) => ipcRenderer.send('interaction:update', spec),
  interactionEnd: (spec) => ipcRenderer.invoke('interaction:end', spec),
  onInteractionReject: (cb) => ipcRenderer.on('interaction:reject', (_e, d) => cb(d)),

  perfGaps: (process.argv || []).includes('--perf-gaps=1'),

  forceInteractive: (process.argv || []).includes('--force-interactive=1'),
  perfGapsReport: (summary) => ipcRenderer.send('perf:gaps', summary),
  onSettings: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
  onUpdate: (cb) => ipcRenderer.on('update:changed', (_e, info) => cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on('update:download-progress', (_e, p) => cb(p)),
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

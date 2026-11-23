'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const {
  app, BrowserWindow, Tray, Menu, screen, nativeImage, powerMonitor, protocol, ipcMain,
} = require('electron');

protocol.registerSchemesAsPrivileged([
  { scheme: 'theme', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },

  { scheme: 'module', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const { JsonStore } = require('./store');
const { CompanionService } = require('./service');
const { createHistoryRecorder } = require('./history-recorder');
const { createHistoryGate } = require('./history-gate');
const { createPointerHistory, createContactHistory } = require('./pointer-history');
const { PointerWatcher } = require('./pointer-watch');
const { ForegroundWatcher } = require('./foreground');
const { resolveWindowBounds } = require('./window-bounds');
const { checkForUpdates } = require('./update-check');
const { createLayoutStore } = require('./layout-store');
const { createLayoutService } = require('./layout-service');
const { createInputTrace, traceEnabled } = require('./input-trace');
const { createPerfTrace, perfEnabled } = require('./perf-trace');
const { stopBand, setBandHost, setBandHealth } = require('./topmost');
const { HelperHealth } = require('./helper-health');
const { NativeHost } = require('./native-host');
const { createDragSession } = require('./drag-session');
const { createModuleStore, TRASH_DAYS } = require('./module-store');
const { createThemeStore } = require('./theme-store');
const { createWorkspaceStore } = require('./workspace-store');
const { createUserModuleStore } = require('./user-module-store');
const { createProofStore } = require('./proof-profiles');
const { wireIpc } = require('./ipc');
const { runShot } = require('./shot');
const { createPanes } = require('./panes');
const { createWindows } = require('./windows');
const whatsNew = require('./whats-new');
const { createShortcutActions } = require('./shortcut-actions');
const { createQuickState } = require('./quick-state');
const ShortcutModel = require('../shared/shortcut-model');
const Proof = require('../shared/proof');
const Color = require('../shared/color');
const ModuleManifest = require('../shared/module-manifest');
const LayoutModel = require('../shared/layout-model');
const LayoutGeometry = require('../shared/layout-geometry');
const { createMainCapabilities } = require('./capabilities');
const { createStateHub } = require('./state-hub');
const { createInteractionHub } = require('./interaction');
const { createPeerHub } = require('./peer-hub');
const { createSecretStore } = require('./secret-store');
const { createComputeHost } = require('./compute-host');
const { createSettingsService } = require('./settings-service');
const { broadcast: broadcastTo, sendTo, sendToWebContents } = require('./broadcast');
const { createCaptureService } = require('./capture-service');
const { decodeQrFrame } = require('./capture');
const { createSender } = require('./sender');
const cspShortcuts = require('./csp-shortcuts');
const cspAccel = require('../shared/csp-accel');
const { createMainI18n } = require('./i18n');
const { portableDataDir, portableRoot, usableDataDir } = require('./portable');
const { downloadTo, assertWritableDir, portableHelperScript } = require('./update-install');

let capabilities = null;

let stateHub = null;
let peerHub = null;

const interactions = createInteractionHub();
const localFirst = process.argv.includes('--local-first');

const traceInteraction = process.argv.includes('--trace-interaction');

/** One line per native-helper exchange, for verifying the host against the app. */
const traceNative = process.argv.includes('--trace-native');

/** --perf-gaps: record frame gaps during a gesture (docs/PERF.md). */
const perfGaps = perfEnabled();

let computeHost = null;

/** The session's native helper (src/main/native-host.js); null when it is disabled. */
let nativeHost = null;

let captureService = null;

let sender = null;
let contactReadSeq = 0;

let mainI18n = null;

const portableDir = portableDataDir();

const explicitUserDataDir = process.argv.some((a) => a === '--user-data-dir' || a.startsWith('--user-data-dir='));
if (portableDir && !explicitUserDataDir) {
  if (usableDataDir(portableDir)) app.setPath('userData', portableDir);
  else console.warn(`[portable] ${portableDir} is not writable; using the usual app-data folder`);
}

if (!app.isPackaged && !explicitUserDataDir && !portableDir) {
  try {
    const product = require('../package.json').build?.productName;
    if (product) app.setPath('userData', path.join(app.getPath('appData'), product));
  } catch {  }
}

const moduleStore = createModuleStore(() => app.getPath('userData'));
const themeStore = createThemeStore(() => app.getPath('userData'));
const workspaceStore = createWorkspaceStore(() => app.getPath('userData'));

const userModuleArg = (() => {
  const i = process.argv.indexOf('--user-module');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : '';
})();

const captureFakeArg = (() => {
  const i = process.argv.indexOf('--capture-fake');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : '';
})();
const userModuleStore = userModuleArg
  ? createUserModuleStore(null, { modulesDir: () => userModuleArg })
  : createUserModuleStore(() => app.getPath('userData'));
const proofStore = createProofStore({ settings: { get: () => settings.get() } });

const registry = ModuleManifest.registry();
const layout = createLayoutService({
  store: createLayoutStore(() => app.getPath('userData'), { registry }),
  registry,
});

const readLayoutDoc = () => layout.v1();
const writeLayoutDoc = (doc) => layout.writeV1(doc).ok;

const paletteColumns = (paletteId) => layout.paletteColumns(paletteId);
const setPaletteColumns = (paletteId, columns) => layout.setColumns(paletteId, columns);
const findFloatDoc = (id) => layout.findFloat(id);
const hasStoredLayout = () => layout.hasStoredDoc();
const revision = () => layout.revisions();
/** Apply one layout intent (the way forward; docs/LAYOUT.md). */
const dispatchLayout = (intent) => layout.apply(intent);

/**
 * One-time workspace seeds. Each is recorded in the document itself (`layout.markSeeded`), so it
 * runs once and never re-adds something the user removed.
 *
 * `one-palette` gives a workspace written before these modules existed the `session` and
 * `color-stat` cards. When the shell's own chrome went away (docs/LAYOUT.md, "One palette"), an
 * upgrading user would otherwise lose the connection status, the profile switcher and the HEX —
 * so the two cards are mounted, each only if the workspace has no instance of that module.
 */
function seedOneTimeWorkspace() {
  try {
    if (!hasStoredLayout()) return;
    const doc = layout.current();
    if (!doc || (doc.seeded || []).includes('one-palette')) return;
    const present = (moduleId) => (doc.palettes || []).some((p) => (p.columns || []).some(
      (c) => (c.modules || []).some((m) => m.moduleId === moduleId),
    )) || (doc.hiddenInstances || []).some((h) => h.moduleId === moduleId);
    for (const moduleId of ['session', 'color-stat']) {
      if (!present(moduleId)) applyLayoutIntent({ type: 'module.enable', moduleId });
    }
    applyLayoutIntent({ type: 'layout.markSeeded', key: 'one-palette' });
  } catch (err) {

    if (isDev) console.warn('[layout] one-palette seed skipped:', err && err.message);
  }
}
/** The primary palette's id — the palette window's own palette. */
const primaryPaletteId = () => {
  const doc = layout.current();
  return doc.palettes[0] ? doc.palettes[0].id : null;
};

/**
 * The window a palette lives in, whatever its position in the list (plan P6a). One
 * lookup, so no caller has to know that "palette 0" happens to be `ctx.popup`.
 */
const windowForPalette = (paletteId) => {
  if (!paletteId) return null;

  const floatWin = ctx.floatWins.get(paletteId);
  if (floatWin && !floatWin.isDestroyed()) return floatWin;
  if (paletteId === primaryPaletteId() && ctx.popup && !ctx.popup.isDestroyed()) return ctx.popup;
  return null;
};

/** Every palette window (the popup and the floats) — for a broadcast that must reach them all. */
const paletteWindows = () => {
  const out = [];
  if (ctx.popup && !ctx.popup.isDestroyed()) out.push(ctx.popup);
  for (const win of ctx.floatWins.values()) if (!win.isDestroyed()) out.push(win);
  return out;
};
/** One palette of the live document (for the window layer and the IPC). */
const layoutPalette = (paletteId) => layout.palette(paletteId);

/** The palettes joined to `paletteId`'s edges (direct children in the graph). */
const snapFollowers = (paletteId) => (layout.current().palettes || [])
  .filter((p) => p.snap && p.snapTo === paletteId);

/** The CSS-pixel minimum a pane reports, converted to screen DIP for the current zoom. */
const paneMinSize = (paletteId, axis) => {
  const win = windowForPalette(paletteId);
  const report = ctx.boardMetrics ? ctx.boardMetrics.get(paletteId) : null;
  const zoom = (win && win.webContents && win.webContents.getZoomFactor && win.webContents.getZoomFactor()) || 1;
  const fallback = axis === 'height' ? 80 : 120;
  const value = report ? report[axis === 'height' ? 'minHeight' : 'minWidth'] : null;
  return Number.isFinite(value) ? Math.max(1, Math.round(value * zoom)) : fallback;
};

/**
 * Move every follower of `paletteId` flush to its anchor, recursively. Used while a
 * palette moves (the drag session moves a whole group itself, so this returns early
 * during a drag). It preserves each follower's size: resizes go through
 * `reflowSnapResize`, which owns the shared-edge splitter.
 */
const followSnapGroup = (paletteId, prev, next) => {
  if (!paletteId || !prev || !next) return;
  if (typeof dragSession !== 'undefined' && dragSession.active && dragSession.active()) return;
  if (prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height) return;
  const queue = [paletteId];
  const seen = new Set(queue);
  while (queue.length) {
    const anchorId = queue.shift();
    const anchorWin = windowForPalette(anchorId);
    if (!anchorWin || anchorWin.isDestroyed()) continue;
    const anchor = anchorWin.getBounds();
    for (const follower of snapFollowers(anchorId)) {
      if (seen.has(follower.id)) continue;
      seen.add(follower.id);
      queue.push(follower.id);
      const fw = windowForPalette(follower.id);
      if (!fw || fw.isDestroyed()) continue;
      const b = fw.getBounds();
      const at = LayoutGeometry.snapFlush(anchor, b, follower.snap);
      if (at.x === b.x && at.y === b.y) continue;
      fw.setBounds({ x: Math.round(at.x), y: Math.round(at.y), width: b.width, height: b.height });
      dispatchLayout({ type: 'palette.setBounds', paletteId: follower.id, pos: { x: Math.round(at.x), y: Math.round(at.y) } });
    }
  }
};

/** Move (never resize) the followers of a pane after a splitter correction. */
const flushDeeperFollowers = (paletteId, excludeId) => {
  const anchorWin = windowForPalette(paletteId);
  if (!anchorWin || anchorWin.isDestroyed()) return;
  const anchor = anchorWin.getBounds();
  for (const follower of snapFollowers(paletteId)) {
    if (follower.id === excludeId) continue;
    const fw = windowForPalette(follower.id);
    if (!fw || fw.isDestroyed()) continue;
    const b = fw.getBounds();
    const at = LayoutGeometry.snapFlush(anchor, b, follower.snap);
    if (at.x === b.x && at.y === b.y) continue;
    fw.setBounds({ x: Math.round(at.x), y: Math.round(at.y), width: b.width, height: b.height });
    dispatchLayout({ type: 'palette.setBounds', paletteId: follower.id, pos: { x: Math.round(at.x), y: Math.round(at.y) } });
  }
};

let reflowUntil = 0;

/**
 * A resize of a snapped pane: the shared edge is a splitter. The other window is
 * resized/moved so the pair stays flush and the group's outer edge stays fixed.
 * A pane that is not in a group, or whose outer edge was resized, is left alone.
 */
const reflowSnapResize = (paletteId, prev, next) => {
  if (!paletteId || !prev || !next) return;
  if (Date.now() < reflowUntil) return;
  if (typeof dragSession !== 'undefined' && dragSession.active && dragSession.active()) return;
  if (ctx.popupParked || Date.now() < ctx.parkReleaseAt) return;
  if (prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height) return;
  const palette = layout.palette(paletteId);
  if (!palette) return;
  const follower = palette.snap && palette.snapTo ? palette : null;
  const anchor = follower ? null : snapFollowers(paletteId)[0] || null;
  if (!follower && !anchor) return;
  const pair = follower
    ? { anchorId: follower.snapTo, followerId: follower.id, side: follower.snap, resizedRole: 'follower' }
    : { anchorId: paletteId, followerId: anchor.id, side: anchor.snap, resizedRole: 'anchor' };
  const anchorWin = windowForPalette(pair.anchorId);
  const followerWin = windowForPalette(pair.followerId);
  if (!anchorWin || anchorWin.isDestroyed() || !followerWin || followerWin.isDestroyed()) return;
  const anchorRect = anchorWin.getBounds();
  const followerRect = followerWin.getBounds();
  const horizontal = pair.side === 'left' || pair.side === 'right';
  const axis = horizontal ? 'width' : 'height';
  const out = LayoutGeometry.reflowSnapResize({
    side: pair.side,
    resizedRole: pair.resizedRole,
    prevAnchor: pair.resizedRole === 'anchor' ? prev : anchorRect,
    anchor: anchorRect,
    prevFollower: pair.resizedRole === 'follower' ? prev : followerRect,
    follower: followerRect,
    minAnchor: paneMinSize(pair.anchorId, axis),
    minFollower: paneMinSize(pair.followerId, axis),
  });
  if (!out || !out.changed) return;
  reflowUntil = Date.now() + 250;
  const apply = (id, rect, before) => {
    if (rect.x === before.x && rect.y === before.y && rect.width === before.width && rect.height === before.height) return;
    const win = windowForPalette(id);
    if (!win || win.isDestroyed()) return;
    win.setBounds({
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)),
    });
    const z = (win.webContents && win.webContents.getZoomFactor && win.webContents.getZoomFactor()) || 1;
    dispatchLayout({
      type: 'palette.setBounds',
      paletteId: id,
      pos: { x: Math.round(rect.x), y: Math.round(rect.y) },
      size: {
        width: Math.max(1, Math.round(rect.width / z)),
        height: Math.max(1, Math.round(rect.height / z)),
      },
    });
  };
  apply(pair.anchorId, out.anchor, anchorRect);
  apply(pair.followerId, out.follower, followerRect);

  flushDeeperFollowers(pair.anchorId, pair.followerId);
  flushDeeperFollowers(pair.followerId);
};

/**
 * Push the document to every window, each getting its own columns (the palette its
 * own, a float its own). V2's promise: main owns the state, every window mirrors
 * it — and a layout change that only reached the palette is how a float used to go
 * stale (docs/LAYOUT.md).
 */
const broadcastLayout = () => {
  const doc = layout.v1();

  if (stateHub) stateHub.set('layout', ctx.currentWorkspace());

  const paletteState = (id) => {
    const p = layout.palette(id);
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      snap: p.snap || null,
      snapTo: p.snapTo || null,
      hasFollowers: (layout.current().palettes || []).some((q) => q.snap && q.snapTo === p.id),
      collapsed: Boolean(p.collapsed),
    };
  };
  const send = (win, columns, id) => {
    sendTo(win, 'layout:changed', { version: 1, columns: columns || [], palette: paletteState(id) });
  };
  send(ctx.popup, doc.columns || [], ctx.primaryPaletteId());
  for (const [floatId, win] of ctx.floatWins) {
    const entry = (doc.floats || []).find((f) => f.floatId === floatId);
    send(win, entry ? entry.columns : [], floatId);
  }
};

/**
 * The size rule, in one place (docs/LAYOUT.md, "Snapping"), in CSS pixels:
 *
 *   a new column  → + the item's width  + the seam
 *   a row added   → + the item's height + the gap
 *   a column gone → − that column's drawn width  − the seam
 *   a row gone    → − the item's height − the gap
 *
 * It grows *and* it shrinks — a window that only ever grew got bigger with every drag — clamped by
 * the window's own minimum (the board's report) and the display's work area. Measurements come from
 * the board's drawn boxes, because the document's widths are hints.
 */
const SEAM = 8;
const fitPane = (paletteId, change) => {
  if (!paletteId || !change) return;
    const win = windowForPalette(paletteId);
  if (!win || win.isDestroyed()) return;
  const zoom = (win.webContents && win.webContents.getZoomFactor && win.webContents.getZoomFactor()) || 1;
  const [cw, ch] = win.getContentSize();
  const nowW = cw / zoom;
  const nowH = ch / zoom;
  const report = ctx.boardMetrics.get(paletteId) || {};
  const gap = Number.isFinite(report.gap) ? report.gap : 2;
  let dw = 0;
  let dh = 0;
  if (change.kind === 'columns-added') {
    dw = (Number(change.px) || 0) + SEAM;
  } else if (change.kind === 'columns-removed') {
    const boxes = (report.boxes && report.boxes.columns) || [];
    const gone = new Set(change.columnIds || []);
    const measured = boxes
      .filter((b) => gone.has(b.id))
      .reduce((sum, b) => sum + (Number(b.width) || 0) + SEAM, 0);
    dw = -(measured || (Number(change.px) || 0));
  } else if (change.kind === 'module-added' || change.kind === 'module-removed') {

    return;
  } else if (change.kind === 'content' && change.size) {
    dw = Math.max(0, (Number(change.size.width) || 0) - nowW);
  } else {
    return;
  }
  const minW = Number.isFinite(report.minWidth) ? report.minWidth : 120;
  const minH = Number.isFinite(report.minHeight) ? report.minHeight : 120;
  const display = screen.getDisplayMatching(win.getBounds());
  const capW = Math.max(minW, Math.floor(display.workAreaSize.width / zoom));
  const capH = Math.max(minH, Math.floor(display.workAreaSize.height / zoom));
  const wantW = Math.max(minW, Math.min(capW, Math.round(nowW + dw)));
  const wantH = Math.max(minH, Math.min(capH, Math.round(nowH + dh)));
  if (wantW === Math.round(nowW) && wantH === Math.round(nowH)) return;
  win.setContentSize(Math.round(wantW * zoom), Math.round(wantH * zoom));
};

/** Apply one intent and, if it changed anything, tell the windows (the one path). */
const applyLayoutIntent = (intent) => {
  const result = dispatchLayout(intent);
  if (result && result.ok && !result.noop) {
    applyLayoutEffects(result.effects);

    syncShellPalette();
    broadcastLayout();
    if (typeof ctx.pruneShortcutTargets === 'function') ctx.pruneShortcutTargets();
    if (typeof ctx.pruneSuppressed === 'function') ctx.pruneSuppressed();
  }
  return result;
};

/** Is this palette the one the shell window shows (the first in the document)? */
let shellPaletteId = null;
const syncShellPalette = () => {
  const id = primaryPaletteId();
  if (!id || id === shellPaletteId) return;
  const first = shellPaletteId === null;
  shellPaletteId = id;
  if (first) return;
  if (!ctx.popup || ctx.popup.isDestroyed()) return;
  if (ctx.takePrimary) ctx.takePrimary(id);
  ctx.popup.reload();

  const b = ctx.popup.getBounds();
  const z = (ctx.popup.webContents && ctx.popup.webContents.getZoomFactor && ctx.popup.webContents.getZoomFactor()) || 1;
  dispatchLayout({
    type: 'palette.setBounds',
    paletteId: id,
    pos: { x: b.x, y: b.y },
    size: { width: Math.round(b.width / z), height: Math.round(b.height / z) },
  });
};

/** The box an instance was last drawn in, anywhere main has a report for. */
const drawnBoxFor = (instanceId) => {
  if (!instanceId || !ctx.boardMetrics) return null;
  for (const report of ctx.boardMetrics.values()) {
    for (const column of (report.boxes && report.boxes.columns) || []) {
      for (const m of column.modules || []) {
        if (m.instanceId === instanceId) return { width: column.width, height: m.height };
      }
    }
  }
  return null;
};

/**
 * Apply what an intent changed: the document is the truth, and these are the
 * windows that have to follow it (docs/LAYOUT.md, V6). Opening a window for a
 * module that was just dropped out sizes it from the box that module was drawn in —
 * the old float:add path measured the same thing, and it is what makes a dragged-out
 * module's window look like the module.
 */
const applyLayoutEffects = (effects) => {
  for (const effect of effects || []) {
    if (effect.type === 'palette.open') {
      const palette = layout.palette(effect.paletteId);
      const sole = palette && palette.columns.length === 1 && (palette.columns[0].modules || []).length === 1
        ? palette.columns[0].modules[0].instanceId
        : null;
      const box = sole ? drawnBoxFor(sole) : null;

      ctx.openPane(effect.paletteId, box
        ? { width: box.width + 6, height: box.height + 26 }
        : null);
    } else if (effect.type === 'palette.setBounds') {

      const win = windowForPalette(effect.paletteId);
      if (win && !win.isDestroyed() && effect.pos) {
        const b = win.getBounds();
        win.setBounds({ x: Math.round(effect.pos.x), y: Math.round(effect.pos.y), width: b.width, height: b.height });
      }
    } else if (effect.type === 'palette.close') {
      ctx.closePane(effect.paletteId);
    } else if (effect.type === 'palette.fit') {
      fitPane(effect.paletteId, effect.change);
    }
  }
};
/**
 * The live panes for the drop resolver (docs/LAYOUT.md, V4): each visible window
 * with its screen rect, zoom, the columns the document says it holds, and — once a
 * board has reported — the boxes it actually drew (which wins).
 *
 * Overlap order: the most recently shown/moved window first and the palette last,
 * because a float is normally opened over the palette. `resolveDrop` takes the
 * first pane containing the point, so this order *is* the rule.
 */
/**
 * How a palette drag works: the group of palettes it carries, with each member's screen
 * position, and the hide/show pair that makes the drag a name chip only (docs/LAYOUT.md,
 * "Snap zones"). A group is the connected component of the document's attach graph — `snap`
 * (which edge this palette sits against) and `snapTo` (the anchor) — so membership is derived
 * and nothing extra is stored. A palette with no attachment is a group of one.
 */
const paletteDragMembers = (paletteId) => {
  const doc = layout.current();
  const byId = new Map((doc.palettes || []).map((p) => [p.id, p]));
  if (!byId.has(paletteId)) return [];
  const attached = (p) => Boolean(p && p.snap && p.snapTo);
  const neighbours = (id) => (doc.palettes || []).filter((p) => {
    if (p.id === id) return false;
    if (attached(p) && p.snapTo === id) return true;
    const me = byId.get(id);
    return attached(me) && me.snapTo === p.id;
  });
  const seen = new Set([paletteId]);
  const queue = [paletteId];
  while (queue.length) {
    for (const n of neighbours(queue.shift())) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      queue.push(n.id);
    }
  }
  const members = [];
  for (const id of seen) {
    const win = windowForPalette(id);
    if (!win || win.isDestroyed()) continue;
    const b = win.getBounds();
    members.push({ paletteId: id, x: b.x, y: b.y, width: b.width, height: b.height });
  }
  return members;
};

/** Which windows a drag has made invisible (they come back when it ends). */
const paneList = ({ source } = {}) => {

  const panes = [];
  const push = (palette, win) => {
    if (!palette || !win || win.isDestroyed() || !win.isVisible()) return;
    const b = win.getBounds();
    const reported = ctx.boardMetrics ? ctx.boardMetrics.get(palette.id) : null;
    panes.push({
      paletteId: palette.id,
      rect: { x: b.x, y: b.y, width: b.width, height: b.height },
      zoom: (win.webContents && win.webContents.getZoomFactor && win.webContents.getZoomFactor()) || 1,
      columns: palette.columns,
      boxes: reported ? reported.boxes : null,
      pad: reported ? reported.pad : undefined,
      divider: reported ? reported.divider : undefined,
      gap: reported ? reported.gap : undefined,
    });
  };
  for (const [floatId, win] of [...ctx.floatWins].reverse()) push(layout.palette(floatId), win);
  push(layout.palette(primaryPaletteId()), ctx.popup);

  if (source) {
    const at = panes.findIndex((p) => p.paletteId === source);
    if (at >= 0) panes.push(panes.splice(at, 1)[0]);
  }
  return panes;
};

/**
 * Where the drag session looks for the pointer. `--cursor x,y` overrides it, so a
 * drag can be driven deterministically — there is no way to move the real mouse
 * from a script, and the session's whole point is that it owns the pointer.
 */
let debugCursor = null;

const Drop = require('../shared/drop-resolve');

/** How close an edge must be to join: proximity is the whole snap rule (docs/LAYOUT.md). */
const SNAP_TOL = 14;
/** The join a palette drag would make right now, as the segment the overlay draws (screen DIP). */
let dragJoinLine = null;

/**
 * The nearest edge of another palette this rect could join, within `SNAP_TOL`, together with the
 * segment to draw for it (screen DIP). One function, so the line you see while dragging is the join
 * you get on release — and it covers all four edges, which the old left/right hint never did.
 * `snap` names the side of the *anchor* the palette sits on, so my left edge meeting their right
 * edge is a `right` join; getting that backwards flushes the pair the wrong way round.
 */
function nearestJoin(me, others) {
  if (!me || !me.width || !me.height) return null;
  let best = null;
  const consider = (side, distance, pane) => {
    if (!Number.isFinite(distance) || distance > SNAP_TOL) return;
    if (best && best.distance <= distance) return;
    const b = pane.rect;
    let line = null;
    if (side === 'right' || side === 'left') {
      const y0 = Math.max(me.y, b.y);
      const y1 = Math.min(me.y + me.height, b.y + b.height);
      if (y1 > y0) line = { x: side === 'right' ? b.x + b.width : b.x, y: y0, length: y1 - y0, axis: 'v' };
    } else {
      const x0 = Math.max(me.x, b.x);
      const x1 = Math.min(me.x + me.width, b.x + b.width);
      if (x1 > x0) line = { x: x0, y: side === 'bottom' ? b.y + b.height : b.y, length: x1 - x0, axis: 'h' };
    }
    if (!line) return;
    best = { side, distance, paletteId: pane.paletteId, line };
  };
  for (const pane of others) {
    const b = pane.rect;

    if (me.y < b.y + b.height && me.y + me.height > b.y) {
      consider('right', Math.abs(me.x - (b.x + b.width)), pane);
      consider('left', Math.abs(me.x + me.width - b.x), pane);
    }
    if (me.x < b.x + b.width && me.x + me.width > b.x) {
      consider('bottom', Math.abs(me.y - (b.y + b.height)), pane);
      consider('top', Math.abs(me.y + me.height - b.y), pane);
    }
  }
  return best;
}

/**
 * A palette drag's release: commit where the windows ended up, then join the nearest edge within
 * `SNAP_TOL` — or come free. There is no zone to aim at: you drop a palette near another's edge and
 * it flushes against it, which is how it worked before the zones, minus the magic that used to
 * pull a window in from anywhere. The reducer positions a joining palette flush against its anchor.
 */
function settleWindowMove(payload, dx, dy) {
  let ok = true;
  const placed = [];
  for (const m of payload.members) {
    const pos = { x: Math.round(m.x + dx), y: Math.round(m.y + dy) };
    placed.push({
      paletteId: m.paletteId, x: pos.x, y: pos.y,
      width: Number(m.width) || 0, height: Number(m.height) || 0,
    });
    const out = applyLayoutIntent({ type: 'palette.setBounds', paletteId: m.paletteId, pos });
    if (!out || out.ok === false) ok = false;
  }
  const source = payload.sourcePaletteId;
  if (!source) return { ok };

  const current = (layout.current().palettes || []).find((p) => p.id === source);
  if (current && current.snap && current.snapTo && payload.members.length > 1) {
    return { ok, snapped: current.snap, snapTo: current.snapTo, kept: true };
  }
  const me = placed.find((p) => p.paletteId === source);
  if (!me || !me.width || !me.height) return { ok };
  const others = paneList().filter((p) => !placed.some((q) => q.paletteId === p.paletteId));
  const join = nearestJoin(me, others);
  const out = applyLayoutIntent({
    type: 'palette.setSnap',
    paletteId: source,
    snap: join ? join.side : null,
    snapTo: join ? join.paletteId : null,
  });
  return {
    ok: ok && Boolean(out && out.ok !== false),
    snapped: join ? join.side : null,
    snapTo: join ? join.paletteId : null,
  };
}

/**
 * The one drag session (docs/LAYOUT.md, V4): main polls the cursor, resolves with
 * the one resolver, draws the one overlay, and commits the plan it drew.
 */
const dragSession = createDragSession({
  cursor: () => {
    if (debugCursor) return debugCursor;
    const p = screen.getCursorScreenPoint();
    return { x: p.x, y: p.y };
  },
  getPanes: (payload) => {

    if (payload && payload.kind === 'palette') {
      const skip = new Set([payload.sourcePaletteId]);
      for (const m of payload.members || []) skip.add(m.paletteId);
      return paneList({ source: payload.sourcePaletteId }).filter((p) => !skip.has(p.paletteId));
    }
    return paneList({ source: payload && payload.sourcePaletteId });
  },
  show: (state) => {

    const pane = state.paletteId ? paneList().find((p) => p.paletteId === state.paletteId) : null;
    const zoom = pane ? pane.zoom : 1;
    const line = state.line && pane
      ? {
        x: pane.rect.x + state.line.x * zoom,
        y: pane.rect.y + state.line.y * zoom,
        length: state.line.length * zoom,
        axis: state.line.axis,
      }
      : null;
    ctx.showOverlay(null, { text: state.text, hint: state.hint, x: state.x, y: state.y, line: line || dragJoinLine });
  },
  hide: () => ctx.hideOverlay(),
  onEnd: () => {

    if (isDev) console.log('[drag] ended');
    dragJoinLine = null;
  },
  dispatch: (intent) => applyLayoutIntent(intent),

  moveWindows: (members, dx, dy) => {
    const placed = [];
    for (const m of members) {
      const pos = { x: Math.round(m.x + dx), y: Math.round(m.y + dy) };
      placed.push({
        paletteId: m.paletteId, x: pos.x, y: pos.y,
        width: Number(m.width) || 0, height: Number(m.height) || 0,
      });
      const win = windowForPalette(m.paletteId);
      if (!win || win.isDestroyed()) continue;
      const b = win.getBounds();
      win.setBounds({ x: pos.x, y: pos.y, width: b.width, height: b.height });
    }

    const me = placed[0];
    const others = paneList().filter((p) => !placed.some((q) => q.paletteId === p.paletteId));
    const join = members.length > 1 ? null : nearestJoin(me, others);
    dragJoinLine = join ? join.line : null;
  },
  settleWindows: (payload, dx, dy) => settleWindowMove(payload, dx, dy),

  deferPaletteMerge: true,
  restoreWindows: (members) => {

    restoreMergePositions(members);
  },
});

let pendingMerge = null;

function restoreMergePositions(members) {
  for (const m of members || []) {
    const win = windowForPalette(m.paletteId);
    if (win && !win.isDestroyed()) {
      win.setBounds({ x: m.x, y: m.y, width: m.width, height: m.height });
    }

    applyLayoutIntent({ type: 'palette.setBounds', paletteId: m.paletteId, pos: { x: m.x, y: m.y } });
  }
}

function cancelPendingMerge() {
  if (!pendingMerge) return false;
  const merge = pendingMerge;
  pendingMerge = null;
  ctx.closeOverlayConfirm();
  restoreMergePositions(merge.payload.members);
  return true;
}

function beginPaletteMerge(merge) {
  if (!merge || !merge.target) return false;
  cancelPendingMerge();
  const source = (layout.palette(merge.payload.sourcePaletteId) || {}).name
    || merge.payload.text || 'Palette';
  const target = (layout.palette(merge.target.paletteId) || {}).name || 'Palette';
  const count = (merge.payload.members || []).length;
  pendingMerge = merge;
  const point = screen.getCursorScreenPoint();
  ctx.showOverlayConfirm({
    anchor: { x: point.x, y: point.y },
    title: ctx.t('dialog.mergePaletteTitle'),
    message: ctx.t('dialog.mergePaletteMessage', { source, target }),
    detail: count > 1 ? ctx.t('dialog.mergePaletteGroup') : ctx.t('dialog.mergePaletteDetail'),
    confirmLabel: ctx.t('dialog.mergePaletteConfirm'),
    cancelLabel: ctx.t('dialog.cancel'),
    danger: true,
  });
  return true;
}

function resolvePendingMerge(ok) {
  if (!pendingMerge) return { ok: false, error: 'no-pending-merge' };
  const merge = pendingMerge;
  pendingMerge = null;
  ctx.closeOverlayConfirm();
  if (!ok) {
    restoreMergePositions(merge.payload.members);
    return { ok: true, canceled: true };
  }
  const out = applyLayoutIntent({
    type: 'layout.place',
    sourcePaletteId: merge.payload.sourcePaletteId,
    items: merge.payload.items,
    grouping: merge.payload.grouping,
    target: merge.target,
    grown: merge.payload.itemSize || undefined,
  });
  if (!out || out.ok === false) {
    restoreMergePositions(merge.payload.members);
    return { ok: false, error: (out && out.error) || 'merge-failed' };
  }
  return { ok: true, rev: out.rev };
}
/**
 * The primary palette's remembered placement — the document is the source of
 * truth for window geometry now, so `settings.json#windowBounds` is legacy
 * (read once by the v1 migration) and is not written any more.
 */
const primaryPlacement = () => {
  const palette = layout.palette(primaryPaletteId());
  if (!palette) return null;
  return {
    x: palette.pos.x,
    y: palette.pos.y,
    displayId: palette.pos.displayId,
    width: palette.size.width,
    height: palette.size.height,
  };
};

const isDev = process.argv.includes('--dev');
const shotIndex = process.argv.indexOf('--shot');
const shotPath = shotIndex >= 0 ? process.argv[shotIndex + 1] : null;

const traceInput = traceEnabled() ? createInputTrace() : null;
const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

let popup = null;
let settingsWin = null;
let tray = null;
let service = null;
let settings = null;

let popupDesign = null;
let fgWatcher = null;
let fgHealthy = false;
let focusGraceUntil = 0;
let hasPositioned = false;
let quoted = false;
let overlayWin = null;
let overlayState = { text: '', hint: false };

let boardMetrics = new Map();
let moduleSettingsWin = null;

let lensWin = null;
let whatsNewWin = null;
let autoConnectTimer = null;
let autoConnectResumeAt = 0;

let autoConnectArmed = false;
let popupParked = false;
let parkReleaseAt = 0;
let parkDepth = 0;
let parkOrigin = null;
const floatWins = new Map();
let edgeHintTimer = null;
let lastFollowAt = 0;

const DEFAULT_SETTINGS = Object.freeze({
  liveSync: true,
  historyGate: false,

  bareCanvasOnly: false,
  bareObserve: true,
  markOutOfDisplay: false,
  autoHide: true,
  autoConnect: true,
  checkUpdatesAutomatically: true,
  lastSeenVersion: '',

  viewFamily: 'all',
  hideModuleNames: false,
  locked: false,
  proofProfile: '',
  proofProfiles: [],
  proofModel: 'working',
  proofMode: 'proof',

  cspDataDir: '',
  uiScale: 1,

  settingsTab: 'appearance',
  theme: 'default-light',
  accents: {},
  launchAtLogin: false,
  summonHotkey: '',
  shortcuts: {
    app: { mode: 'toggle', toggle: '', hold: '', autoDismiss: false, position: 'keep' },
    palettes: {},
  },
  commandBindings: {},
  language: '',
});

/** The shipped UI locales (`src/shared/locales/<code>.js`). */
function listLocaleCodes() {
  try {
    return fs.readdirSync(path.join(__dirname, '..', 'shared', 'locales'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => f.replace(/\.js$/, ''))
      .sort();
  } catch {
    return ['en'];
  }
}

const colorHistory = [];
let historyLoaded = false;
let history = null;
const HISTORY_MAX = 100;

function historyList() {
  if (!historyLoaded) {
    historyLoaded = true;
    const saved = history ? history.get().colorHistory : null;
    if (Array.isArray(saved)) {
      for (const c of saved.slice(0, HISTORY_MAX)) {
        if (Number.isFinite(c && c.r) && Number.isFinite(c.g) && Number.isFinite(c.b)) {
          colorHistory.push({ r: c.r, g: c.g, b: c.b });
        }
      }
    }
  }
  return colorHistory;
}

/** Persist the shared history list to its own file. */
function saveHistory(list) {
  if (history) history.set({ colorHistory: list.map((c) => ({ r: c.r, g: c.g, b: c.b })) });
}

/** The history as a DTCG colour collection (docs/STATE.md, §12.5). */
function historyTokens(list) {
  return {
    collections: [{
      name: 'history:iroiroppa',
      modes: [{
        name: 'Value',
        tokens: list.map((c, i) => ({
          name: `color/${String(i + 1).padStart(2, '0')}`,
          type: 'color',
          value: Color.rgbToHex(c.r, c.g, c.b),
        })),
      }],
    }],
  };
}

function broadcastHistory() {
  const list = historyList().map((c) => ({ ...c }));
  if (stateHub) stateHub.set('history', historyTokens(list));
  sendTo(popup, 'history:changed', list);
  for (const win of floatWins.values()) sendTo(win, 'history:changed', list);
}

const historyRecorder = createHistoryRecorder({
  list: historyList,
  max: HISTORY_MAX,
  save: saveHistory,
  broadcast: broadcastHistory,
});

const historyGate = createHistoryGate({
  isOn: () => Boolean(settings && settings.get().historyGate === true),
  recorder: historyRecorder,
  currentRgb: () => (service && service.lastColor && service.lastColor.rgb) || null,
  resync: broadcastHistory,
});

const {
  describeProfileFile, loadProofProfile, findAdobeRgbProfile, findBundledProfile,
  getProof, listProofProfiles, clearCaches: clearProofCaches,
} = proofStore;

const { listThemes, normalizeTheme, themeBackground, themeAssetPath } = themeStore;

const { listModuleIds, readModuleSettings, writeModuleSettings, copySettings } = moduleStore;

/** Register or remove the app from the Windows login items. */
function applyLaunchAtLogin(on) {
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: Boolean(on) });
    } else {

      app.setLoginItemSettings({
        openAtLogin: Boolean(on),
        path: process.execPath,
        args: [path.resolve(app.getAppPath())],
      });
    }
  } catch (err) {
    console.warn('could not update the login item:', err.message);
  }
}

let updateInfo = { available: false };

/**
 * Ask GitHub for the latest release. It never throws and never surfaces a
 * failure — an unsigned app has nothing useful to say when it is offline, and
 * the comment above each call says so.
 */
async function refreshUpdateCheck() {
  const info = await checkForUpdates({ currentVersion: app.getVersion() });
  if (info && info.available) {
    const portable = Boolean(portableRoot());
    const downloads = info.downloads || {};
    updateInfo = {
      ...info,
      build: portable ? 'portable' : 'installer',

      downloadUrl: (portable ? downloads.portable : downloads.setup) || info.url,
    };
  } else {
    updateInfo = info || { available: false };
  }
  broadcast('update:changed', updateInfo);
  return updateInfo;
}

const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
let updateTimer = null;
let updateKick = null;

function scheduleAutoUpdateCheck() {
  if (updateKick) { clearTimeout(updateKick); updateKick = null; }
  if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
  if (!settings || settings.get().checkUpdatesAutomatically === false) return;
  updateKick = setTimeout(() => {
    updateKick = null;
    refreshUpdateCheck().catch(() => {});
  }, 2500);
  updateKick.unref?.();
  updateTimer = setInterval(() => { refreshUpdateCheck().catch(() => {}); }, UPDATE_CHECK_INTERVAL);
  updateTimer.unref?.();
}

/**
 * Download the asset for this build and hand over:
 * - installer: run the downloaded setup, then quit (the installer closes us too);
 * - portable: a detached helper waits for this process, replaces the exe and
 *   starts it, because Windows will not let a running exe overwrite itself.
 * Nothing here needs a code signature; signing only changes the SmartScreen trust.
 */
async function installUpdate() {
  const info = updateInfo;
  if (!info || !info.available) return { ok: false, error: 'No update is ready.' };
  const build = info.build === 'portable' ? 'portable' : 'installer';
  const downloads = info.downloads || {};
  const url = build === 'portable' ? downloads.portable : downloads.setup;
  if (!url) return { ok: false, error: 'This release has no download for this build.' };
  const target = build === 'portable' ? process.env.PORTABLE_EXECUTABLE_FILE : '';
  if (build === 'portable' && !target) return { ok: false, error: 'The portable exe could not be located.' };
  if (build === 'portable') {
    try { assertWritableDir(path.dirname(target)); } catch {
      return { ok: false, error: 'The portable folder is read-only. Download the new exe instead.' };
    }
  }
  const safe = String(info.version || 'update').replace(/[^\w.-]/g, '_');
  const dest = path.join(app.getPath('temp'), `Iroiroppa-${safe}-${build}.exe`);
  try {
    const size = await downloadTo(url, dest, {
      onProgress: (p) => broadcast('update:download-progress', p),
    });
    broadcast('update:download-progress', { phase: 'ready', received: size.size, total: size.size, percent: 100 });
    if (build === 'portable') {
      const helper = path.join(app.getPath('temp'), `Iroiroppa-replace-${process.pid}.cmd`);
      fs.writeFileSync(helper, portableHelperScript({ appPid: process.pid, source: dest, target }), 'ascii');
      let spawnError = null;
      const child = spawn('cmd.exe', ['/c', helper], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', (err) => { spawnError = err; });
      child.unref();
      await new Promise((r) => setTimeout(r, 300));
      if (spawnError) return { ok: false, error: spawnError.message };
      setTimeout(() => app.quit(), 400);
      return { ok: true, action: 'replace' };
    }
    let spawnError = null;
    const child = spawn(dest, [], { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', (err) => { spawnError = err; });
    child.unref();
    await new Promise((r) => setTimeout(r, 500));
    if (spawnError) return { ok: false, error: spawnError.message };
    setTimeout(() => app.quit(), 300);
    return { ok: true, action: 'install' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** The checked-in release note for the running version, or null. */
function getWhatsNew() {
  try { return whatsNew.read(app.getAppPath(), app.getVersion()); } catch { return null; }
}

/** Record that this version's note has been seen (idempotent). */
function markWhatsNewSeen() {
  try { settings.set({ lastSeenVersion: app.getVersion() }); } catch {  }
}

/** Show the note on the first launch of a version (a fresh install included). */
function maybeShowWhatsNew() {
  try {
    const version = app.getVersion();
    if (settings.get().lastSeenVersion === version) return;
    const info = getWhatsNew();
    if (!info) {
      settings.set({ lastSeenVersion: version });
      return;
    }
    if (windows && typeof windows.openWhatsNew === 'function') windows.openWhatsNew();
  } catch {  }
}

function broadcast(channel, payload) {

  broadcastTo(BrowserWindow.getAllWindows(), channel, payload);
}

/** Map a window's URL to a peer kind (docs/STATE.md, §12.3). */
function kindOfUrl(url) {
  const base = String(url || '').split('/').pop().split('?')[0];
  const kinds = {
    'index.html': 'palette',
    'float.html': 'float',
    'settings.html': 'settings',
    'overlay.html': 'overlay',
    'module-settings.html': 'module-settings',
    'lens.html': 'lens',
  };
  return kinds[base] || 'window';
}

/** Broadcast the live peer list to every window (transient, main-authored). */
/** Merge a health patch and publish it (docs/STATE.md). Accumulates until the hub exists. */
let healthState = {};
function setHealth(patch) {
  healthState = { ...healthState, ...patch };
  if (stateHub) stateHub.set('health', { ...healthState });
}

function broadcastPeers() {
  const peers = peerHub
    ? peerHub.peers().map((p) => ({ peerId: p.peerId, wcId: p.wcId, kind: p.kind, title: p.title }))
    : [];

  if (peerHub) {
    for (const p of peerHub.peers()) {
      if (p.port && typeof p.port.postMessage === 'function') {
        try { p.port.postMessage({ type: 'peers', data: peers }); } catch {  }
      }
    }
  }
  broadcast('peer:peers', peers);
}

/** Renderer intents (docs/STATE.md). There are none yet. */
function applyStateIntent(name) {
  return { ok: false, error: `unknown intent "${name}"` };
}

const ctx = {
  get capabilities() { return capabilities; },
  get stateHub() { return stateHub; },
  get interactions() { return interactions; },
  get localFirst() { return localFirst; },
  get traceInteraction() { return traceInteraction; },
  get peerHub() { return peerHub; },
  get capture() { return captureService; },
  get sender() { return sender; },
  get i18n() { return mainI18n; },
  /** Translate a main-process string (tray, dialogs) — see src/main/i18n.js. */
  t: (key, vars) => (mainI18n ? mainI18n.t(key, vars) : key),
  /** Follow a language change: reload the catalog and refresh the tray menu. */
  applyLanguage: (code) => {
    if (mainI18n) mainI18n.use(code || app.getLocale());
    if (windows && windows.refreshTray) windows.refreshTray();
  },
  get settings() { return settings; },
  get service() { return service; },
  get popup() { return popup; },
  set popup(v) { popup = v; },
  get settingsWin() { return settingsWin; },
  set settingsWin(v) { settingsWin = v; },
  get moduleSettingsWin() { return moduleSettingsWin; },
  set moduleSettingsWin(v) { moduleSettingsWin = v; },
  get lensWin() { return lensWin; },
  set lensWin(v) { lensWin = v; },
  get whatsNewWin() { return whatsNewWin; },
  set whatsNewWin(v) { whatsNewWin = v; },
  get overlayWin() { return overlayWin; },
  set overlayWin(v) { overlayWin = v; },
  get overlayState() { return overlayState; },
  set overlayState(v) { overlayState = v; },
  get boardMetrics() { return boardMetrics; },
  get drawnBoxFor() { return drawnBoxFor; },
  get tray() { return tray; },
  set tray(v) { tray = v; },
  get popupDesign() { return popupDesign; },
  set popupDesign(v) { popupDesign = v; },
  get hasPositioned() { return hasPositioned; },
  set hasPositioned(v) { hasPositioned = v; },
  get fgWatcher() { return fgWatcher; },
  set fgWatcher(v) { fgWatcher = v; },
  get fgHealthy() { return fgHealthy; },
  set fgHealthy(v) { fgHealthy = v; },
  get focusGraceUntil() { return focusGraceUntil; },
  set focusGraceUntil(v) { focusGraceUntil = v; },
  get autoConnectTimer() { return autoConnectTimer; },
  set autoConnectTimer(v) { autoConnectTimer = v; },
  get autoConnectResumeAt() { return autoConnectResumeAt; },
  set autoConnectResumeAt(v) { autoConnectResumeAt = v; },
  get autoConnectArmed() { return autoConnectArmed; },
  set autoConnectArmed(v) { autoConnectArmed = v; },
  get popupParked() { return popupParked; },
  set popupParked(v) { popupParked = v; },
  get parkReleaseAt() { return parkReleaseAt; },
  set parkReleaseAt(v) { parkReleaseAt = v; },
  get parkDepth() { return parkDepth; },
  set parkDepth(v) { parkDepth = v; },
  get parkOrigin() { return parkOrigin; },
  set parkOrigin(v) { parkOrigin = v; },
  get quoted() { return quoted; },
  set quoted(v) { quoted = v; },
  isPortable: () => Boolean(portableRoot()),
  get updateInfo() { return updateInfo; },
    get edgeHintTimer() { return edgeHintTimer; },
  set edgeHintTimer(v) { edgeHintTimer = v; },
  get lastFollowAt() { return lastFollowAt; },
  set lastFollowAt(v) { lastFollowAt = v; },

  floatWins, HISTORY_MAX, isDev, paneList,
  beginPaletteMerge, cancelPendingMerge, resolvePendingMerge,

  moduleStore, mintInstanceId: (prefix) => layout.newId(prefix),
  paletteDragMembers,
  argValue, shotPath, runShot,
  traceInput,
  shortcutList: () => cspShortcuts.list({
    root: settings.get().cspDataDir || undefined,
    documents: app.getPath('documents'),
  }),
  /** The CSP command/tool that already owns an accelerator, or null (see csp-accel.js). */
  cspAccelOwner: (accel) => cspOwnerOf(accel),
  resolveCspFolder: (root) => cspShortcuts.resolveFolder(
    root === undefined ? (settings.get().cspDataDir || '') : root,
    { documents: app.getPath('documents') },
  ),
  localeCodes: listLocaleCodes,
  broadcast, broadcastHistory, historyList, saveHistory,
  commitHistory: (rgb) => historyGate.onExplicit(rgb),
  applyHistoryGate: () => historyGate.onToggle(),
  broadcastPeers, applyStateIntent,
  refreshUpdateCheck, getProof, clearProofCaches, listProofProfiles,
  scheduleAutoUpdateCheck, installUpdate,
  setUpdateInfo: (info) => { updateInfo = info; broadcast('update:changed', updateInfo); },
  getWhatsNew, markWhatsNewSeen,
  openWhatsNew: () => (windows ? windows.openWhatsNew() : false),
  listThemes, normalizeTheme, themeBackground,
  readModuleSettings,

  listModuleIds: () => [...new Set([...listModuleIds(), ...userModuleStore.list().map((m) => m.id)])],
  writeModuleSettings,
  readLayoutDoc, writeLayoutDoc, findFloatDoc,
  paletteColumns, setPaletteColumns,
  windowForPalette, paletteWindows,
  hasStoredLayout, revision, dispatchLayout,
  primaryPaletteId, layoutPalette, primaryPlacement, paneList,
  snapFollowers, followSnapGroup, reflowSnapResize,
  dragSession, broadcastLayout, applyLayoutIntent,
  currentWorkspace: () => layout.current(),

  listNamedWorkspaces: () => workspaceStore.list(),
  getNamedWorkspace: (id) => workspaceStore.get(id),
  saveNamedWorkspace: (name, doc) => workspaceStore.save(name, doc),
  renameNamedWorkspace: (id, name) => workspaceStore.rename(id, name),
  deleteNamedWorkspace: (id) => workspaceStore.remove(id),
  workspaceStore,

  exportWorkspaceTo: async (target) => {
    try {
      fs.writeFileSync(target, JSON.stringify(layout.current(), null, 2));
      return { ok: true, path: target };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
  importWorkspaceFrom: async (source) => {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(source, 'utf8'));
    } catch (err) {
      return { ok: false, error: `could not read ${source}: ${err.message}` };
    }
    const { migrateV1: migrate } = require('./layout-store');
    const doc = raw && raw.version === 2 ? raw : migrate(raw, settings.get());
    const result = applyLayoutIntent({ type: 'workspace.load', doc });
    return { ...result, path: source };
  },
  setDebugCursor: (p) => { debugCursor = p || null; },
  applyLaunchAtLogin,
};

const floats = createPanes(ctx);
Object.assign(ctx, floats);
const {
  applyLocked, reopenFloats, showFloats, windowAtPoint, closeFloatWin,
} = floats;

const helperHealth = new HelperHealth();
ctx.helperHealth = helperHealth;

if (process.argv.includes('--force-degraded-helpers')) {
  for (const name of ['band', 'foreground', 'pointer', 'keys']) helperHealth.set(name, 'ps');
}

const windows = createWindows(ctx);
Object.assign(ctx, windows);
const {
  createPopup, showPopup, showPopupAuto, applyUiScale, buildTray,
  startFollowFocus, stopFollowFocus, scheduleAutoConnect, startPairing,
  applyCommandHotkeys, unregisterCommandHotkeys,
} = windows;

const wantNativeHost = process.argv.includes('--native-host')
  || (!process.argv.includes('--no-native-host'));
/** Push the helper state at every window; cheap, and the palette shows it as a dot. */
const pushHelpers = () => {
  try {
    const payload = helperHealth.summary();
    for (const win of require('electron').BrowserWindow.getAllWindows()) {
      try { win.webContents.send('helpers:state', payload); } catch {  }
    }
  } catch {  }
};
ctx.pushHelpers = pushHelpers;

require('electron').ipcMain.handle('helpers:get', () => helperHealth.summary());

helperHealth.on('changed', (event) => {
  console.log(`[helpers] ${event.capability}: ${event.from} -> ${event.to} (${helperHealth.describe()})`);
  pushHelpers();
  try { setHealth({ helpers: helperHealth.summary() }); } catch {  }
});

if (wantNativeHost) {
  nativeHost = new NativeHost({ log: traceNative ? (line) => console.log('[native]', line) : null });
  ctx.nativeHost = nativeHost;
  setBandHealth(helperHealth);
}

const shortcutActions = createShortcutActions(ctx);
/** How long a "CSP is busy" reading is trusted without a fresh Quick Access read. */
const CSP_BUSY_TTL_MS = 2500;
let cspBusyTimer = null;
/** One place decides the hook's mute, whichever path noticed first. */
function applyBareBusy(busy) {
  shortcutActions.setBareBusy(Boolean(busy));
  if (cspBusyTimer) { clearTimeout(cspBusyTimer); cspBusyTimer = null; }
  if (busy) {
    cspBusyTimer = setTimeout(() => {
      cspBusyTimer = null;
      shortcutActions.setBareBusy(false);
    }, CSP_BUSY_TTL_MS);
  }
}
Object.assign(ctx, {
  applyShortcuts: (next) => shortcutActions.apply(next),
  setBareCanvas: (on) => shortcutActions.setBareCanvas(on),
  setBareObserve: (on) => shortcutActions.setBareObserve(on),
  /**
   * Truthful CSP-side suppressor for bare keys. Measured on CSP 5.x: while a text layer
   * is edited (or any non-brush tool is active) the Quick Access reply reports *no* flag
   * on and lists every requested flag as disabled; with a brush it reports the on flags
   * and an empty disabled list. So "nothing on, something disabled" means CSP would
   * refuse a recipe anyway — a bare key must then pass through to CSP instead of being
   * swallowed. It expires, so a stalled poll can never mute the shortcuts for good.
   */
  /**
   * Truthful CSP-side suppressor for bare keys. Measured on CSP 5.x: while a text layer
   * is edited (or any non-brush tool is active) the Quick Access reply reports *no* flag
   * on and lists every requested flag as disabled; with a brush it reports the on flags
   * and an empty disabled list. So "nothing on, something disabled" means CSP would
   * refuse a recipe anyway — a bare key must then pass through to CSP instead of being
   * swallowed. It expires, so a stalled poll can never mute the shortcuts for good.
   */
  noteQuickAccessState: (state) => {
    const on = Array.isArray(state && state.on) ? state.on.length : 0;
    const disabled = Array.isArray(state && state.disabled) ? state.disabled.length : 0;
    const busy = disabled > 0 && on === 0;
    applyBareBusy(busy);
    return busy;
  },
  applySummonShortcut: (accel) => {
    const current = settings.get();
    const next = ShortcutModel.normalise(current.shortcuts);
    next.app.toggle = String(accel || '').trim();
    const out = shortcutActions.apply({ ...current, shortcuts: next });
    return {
      ok: out.failures.every((f) => f.key !== 'app:toggle'),
      registered: shortcutActions.toggles().has('app:toggle'),
      accelerator: next.app.toggle,
      failures: out.failures,
    };
  },
  stopShowShortcuts: () => shortcutActions.stop(),
  /**
   * The one Quick Access poll in the app (src/main/quick-state.js). Modules declare the
   * names they care about; the poll asks about the union once at one interval and
   * publishes the answer. It also drives the bare-key mute, which is why the last name
   * set is remembered after the last module unloads.
   */
  quickState: (() => {
    const qs = createQuickState({
      read: async (names) => {
        if (!ctx.service || typeof ctx.service.readQuickAccess !== 'function') {
          return { ok: false, error: 'unavailable' };
        }
        return ctx.service.readQuickAccess(names);
      },
      onBusy: (busy) => applyBareBusy(busy),
      onChange: (snap) => {
        broadcast('csp:quickState', {
          ok: snap.ok, on: snap.on, disabled: snap.disabled, names: snap.names, at: snap.at,
        });
      },
    });
    return qs;
  })(),
  endHoldShortcut: () => shortcutActions.endHold(),
  setShowShortcut: (spec) => shortcutActions.set(spec),
  setShortcutOption: (spec) => shortcutActions.setOption(spec),
  setAltClickTarget: (target) => shortcutActions.setAltClick(target),
  afterColorPickShortcut: () => shortcutActions.afterColorPick(),
  drawingStartedShortcut: () => shortcutActions.drawingStarted(),
  interactionStartedShortcut: (info) => shortcutActions.interactionStarted(info),
  setBareActiveShortcut: (active) => shortcutActions.setBareActive(active),
  setBareTypingShortcut: (typing) => shortcutActions.setBareTyping(typing),
  setBareCanvasShortcut: (on) => shortcutActions.setBareCanvas(on),
  registerCommandBare: (spec) => shortcutActions.registerCommandBare(spec),
  clearCommandBare: (key) => shortcutActions.clearCommandBare(key),
  clearAfterPickShortcut: () => shortcutActions.clearAfterPick(),
  pruneShortcutTargets: () => shortcutActions.prune(),
});

if (!shotPath && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (!shotPath) app.on('second-instance', () => showPopup());

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.iroiroppa.app');

    protocol.handle('theme', (request) => {
      let url;
      try { url = new URL(request.url); } catch { return new Response('bad request', { status: 400 }); }
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = themeAssetPath(url.hostname, rel);
      if (!file) return new Response('not found', { status: 404 });
      const TYPES = {
        '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.webp': 'image/webp', '.svg': 'image/svg+xml',
      };
      try {
        const data = fs.readFileSync(file);
        return new Response(data, {
          headers: {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err) {
        return new Response('read error', { status: 500 });
      }
    });

    protocol.handle('module', (request) => {
      let url;
      try { url = new URL(request.url); } catch { return new Response('bad request', { status: 400 }); }
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = userModuleStore.assetPath(url.hostname, rel);
      if (!file) return new Response('not found', { status: 404 });
      const TYPES = {
        '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
        '.css': 'text/css', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
      };
      try {
        const data = fs.readFileSync(file);
        return new Response(data, {
          headers: {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err) {
        return new Response('read error', { status: 500 });
      }
    });

    for (const m of userModuleStore.list()) registry[m.id] = { ...m, user: true };

    ctx.userModulesArg = `--user-modules=${JSON.stringify(userModuleStore.list())}`;

    const legacyState = process.argv.includes('--legacy-state') || argValue('--state') === 'legacy';
    const stateMode = legacyState ? 'legacy' : 'model';
    ctx.windowArgs = ctx.userModulesArg ? [ctx.userModulesArg] : [];

    if (perfGaps) ctx.windowArgs.push('--perf-gaps=1');
    if (process.argv.includes('--force-interactive')) ctx.windowArgs.push('--force-interactive=1');
    ctx.windowArgs.push(`--state-mode=${stateMode}`);

    if (ctx.localFirst) ctx.windowArgs.push('--local-first=1');
    if (process.argv.includes('--hold-interaction')) ctx.windowArgs.push('--hold-interaction=1');

    const dir = app.getPath('userData');

    const defaults = { ...DEFAULT_SETTINGS };
    if (!defaults.proofProfile) defaults.proofProfile = findAdobeRgbProfile() || findBundledProfile();
    settings = createSettingsService({ file: path.join(dir, 'settings.json'), defaults, hooks: ctx });

    if (settings.get().bareObserveMigrated !== true) {
      settings.commit({ bareObserve: true, bareObserveMigrated: true });
    }

    {
      const cur = settings.get();
      const normalized = ShortcutModel.normalise(cur.shortcuts);
      let changed = JSON.stringify(normalized) !== JSON.stringify(cur.shortcuts || {});
      if (cur.summonHotkey && !normalized.app.toggle) {
        normalized.app.toggle = cur.summonHotkey;
        changed = true;
      }
      if (changed) settings.set({ shortcuts: normalized });
    }

    history = new JsonStore(path.join(dir, 'history.json'), { colorHistory: [] });
    if (!fs.existsSync(path.join(dir, 'history.json'))) {
      const saved = settings.get().colorHistory;
      if (Array.isArray(saved) && saved.length) {
        try { fs.copyFileSync(path.join(dir, 'settings.json'), path.join(dir, 'settings.json.pre-history-split.bak')); } catch {  }
        history.set({ colorHistory: saved.map((c) => ({ r: c.r, g: c.g, b: c.b })) });
      }
    }

    mainI18n = createMainI18n({ language: settings.get().language || '', systemLocale: app.getLocale() });

    const legacyTheme = settings.get().theme;
    const migratedTheme = normalizeTheme(legacyTheme);
    if (migratedTheme !== legacyTheme) settings.set({ theme: migratedTheme });

    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
      if (raw && typeof raw.autoHide !== 'boolean' && typeof raw.followCsp === 'boolean') {
        settings.set({ autoHide: raw.followCsp });
      }
    } catch {  }

    const sessionFile = path.join(dir, 'session.json');
    const session = process.argv.includes('--no-secret-store')
      ? new JsonStore(sessionFile, {})
      : createSecretStore({ file: sessionFile, safeStorage: require('electron').safeStorage });

    applyLaunchAtLogin(settings.get().launchAtLogin);

    stateHub = createStateHub({ emit: (channel, payload) => broadcast(channel, payload) });
    const peerBus = !process.argv.includes('--no-peer-bus');
    peerHub = createPeerHub({
      send: (wcId, channel, payload) => {
        const wc = require('electron').webContents.fromId(wcId);
        if (wc && !wc.isDestroyed()) wc.send(channel, payload);
      },

      allocatePort: peerBus ? (wcId) => {
        const { MessageChannelMain } = require('electron');
        const { port1, port2 } = new MessageChannelMain();
        const wc = require('electron').webContents.fromId(wcId);
        if (wc && !wc.isDestroyed()) wc.postMessage('peer:port', null, [port2]);
        port1.start();
        return port1;
      } : () => null,
    });
    peerHub.connect();

    setHealth({ secrets: typeof session.isEncrypted === 'function' && session.isEncrypted() ? 'encrypted' : 'plaintext' });
    app.on('web-contents-created', (_e, wc) => {
      if (!peerHub) return;
      wc.on('did-finish-load', () => {
        if (wc.isDestroyed()) return;
        peerHub.openWindow(wc.id, { kind: kindOfUrl(wc.getURL()), title: wc.getTitle() });
        sendToWebContents(wc, 'peer:peers', peerHub.peers().map((p) => ({
          peerId: p.peerId, wcId: p.wcId, kind: p.kind, title: p.title,
        })));
        sendToWebContents(wc, 'peer:event', { type: 'state', data: { current: peerHub.state() } });
        broadcastPeers();
      });
      wc.on('destroyed', () => { if (peerHub && peerHub.closeWindow(wc.id)) broadcastPeers(); });
    });

    if (!process.argv.includes('--no-compute-host')) {
      computeHost = createComputeHost({

        workerPath: path.join(__dirname, 'workers', 'capture-worker.js').replace('app.asar', 'app.asar.unpacked'),
        onEvent: (type, info) => {
          if (isDev && type === 'up') console.log('[compute] host up');
          setHealth({ compute: type });
          if (type === 'down' && peerHub) peerHub.emitEvent('error', { source: 'compute-host', code: info && info.code });
        },
      });
      app.on('will-quit', () => { if (computeHost) computeHost.dispose(); });

    if (perfGaps) {
      const tracePerf = createPerfTrace();

      ipcMain.on('perf:gaps', (_event, summary) => tracePerf({
        ...summary,
        state: {
          fg: ctx.fgName || '',
          paletteVisible: Boolean(ctx.popup && !ctx.popup.isDestroyed() && ctx.popup.isVisible()),
          autoHide: ctx.settings.get().autoHide !== false,
          interactive: process.argv.includes('--force-interactive'),
          nativeHost: Boolean(nativeHost && nativeHost.available),
        },
      }));
    }

    if (nativeHost) {
      nativeHost.start();
      setBandHost(nativeHost);
      app.on('will-quit', () => nativeHost.stop());
    }

    const summonAfter = (process.argv.find((a) => a.startsWith('--summon-after=')) || '').split('=')[1];
    if (summonAfter) {

      for (const at of String(summonAfter).split(',').map(Number).filter((n) => n > 0)) {
        setTimeout(() => {
          try {

            if (ctx.popup && ctx.popup.isVisible()) { windows.hidePopup(); return; }
            ctx.summonAt = Date.now();
            windows.showPopup();
          } catch {  }
        }, at);
      }
    }

    setHealth({ helpers: helperHealth.summary() });

    setInterval(() => {
      if (!nativeHost || !nativeHost.available) return;
      const summary = helperHealth.summary();
      if (!summary.onFallback.length && !summary.unavailable.length) return;
      try {
        if (ctx.fgWatcher && typeof ctx.fgWatcher.retryHost === 'function') ctx.fgWatcher.retryHost();
        if (typeof ctx.retryPointerHost === 'function') ctx.retryPointerHost();
        if (typeof shortcutActions.retryHosts === 'function') shortcutActions.retryHosts();
      } catch (error) { console.error('[helpers] retry failed', error); }
    }, 30000).unref();

    try { ctx.applyShortcuts(settings.get()); } catch (error) { console.error('[shortcut] startup apply failed', error); }
    }
    service = new CompanionService({
      settings,
      session,
      systemIdleSeconds: () => powerMonitor.getSystemIdleTime(),
      windowVisible: () => Boolean(ctx.popup && !ctx.popup.isDestroyed() && ctx.popup.isVisible()),
      cspForeground: () => (typeof ctx.isCspForeground !== 'function' || !ctx.fgWatcher
        ? true
        : Boolean(ctx.isCspForeground())),
      decodeFrame: computeHost
        ? async (frame) => {
            try { return await computeHost.request('qr-decode', frame); }
            catch (err) {

              if (isDev) console.log('[compute] falling back to in-main decode:', err.message);
              return decodeQrFrame(frame);
            }
          }
        : null,
    });
    service.on('status', (s) => { broadcast('companion:status', s); if (stateHub) stateHub.set('connection', s); setHealth({ csp: s.state }); });
    service.on('color', (c) => {

      if (localFirst) {
        const cur = interactions.get('color');
        if (cur && c && c.rgb) {

          const same = interactions.isRecent('color', c.rgb, (a, b) => Boolean(a && b && a.r === b.r && a.g === b.g && a.b === b.b));
          if (!same) {
            const gone = interactions.invalidate('color', 'invalidated');
            if (gone) {
              const win = require('electron').BrowserWindow.fromId(gone.windowId);
              if (win && !win.isDestroyed()) {
                sendTo(win, 'interaction:reject', { interactionId: gone.interactionId, reason: gone.reason });
              }
              if (traceInteraction) console.log(`[interaction] reject ${gone.interactionId} -> win ${gone.windowId} (${gone.reason})`);
            }
          }
        }
      }
      broadcast('companion:color', c);
      if (stateHub) stateHub.set('color', c);
    });
    service.on('preview', (p) => {
      for (const win of paletteWindows()) {
        if (win.webContents.id === p.sourceId) continue;
        sendTo(win, 'companion:color-preview', { lab: p.lab, active: p.active });
      }
    });
    service.on('pick', (rgb) => historyGate.onPick(rgb));

    let altPickPending = false;
    if (!shotPath) {
      const pointerWatcher = new PointerWatcher();

      if (nativeHost) pointerWatcher.attach(nativeHost, helperHealth);

      ctx.retryPointerHost = () => pointerWatcher.retryHost && pointerWatcher.retryHost();
      const releaseHistory = createPointerHistory({
        readColor: () => service.readColor(),
        commit: (rgb) => historyRecorder.commit(rgb, { replaceHostHead: true }),
        hasPending: () => Boolean(historyRecorder.pending() || historyRecorder.unconfirmed()),
      });
      const contactHistory = createContactHistory({
        isOn: () => settings.get().historyGate === true,
        readColor: () => service.readColor(),
        commit: (rgb) => historyRecorder.commit(rgb),
        pending: () => historyRecorder.pending(),
        head: () => historyList()[0] || null,
        drop: () => historyRecorder.cancel(),
      });
      pointerWatcher.on('up', () => {
        historyGate.onUp(releaseHistory);
        if (altPickPending) {
          altPickPending = false;
          ctx.afterColorPickShortcut();
        }
      });
      pointerWatcher.on('down', (info) => {
        contactHistory(info);

        altPickPending = Boolean(info.alt && info.canvas && !info.ctrl && !info.shift);

        ctx.interactionStartedShortcut(info);
      });
      if (!nativeHost && ctx.helperHealth) ctx.helperHealth.set('pointer', 'ps');
      pointerWatcher.start();
      app.on('will-quit', () => pointerWatcher.stop());
    }
    service.on('status', () => scheduleAutoConnect());

    captureService = createCaptureService({
      getSources: (opts) => require('electron').desktopCapturer.getSources(opts),
      fake: captureFakeArg,
    });
    sender = createSender();
    app.on('will-quit', () => sender.stop());

    capabilities = createMainCapabilities({
      service,
      broadcast: (channel, payload) => {
        broadcast(channel, payload);
        if (stateHub && channel === 'capabilities:changed') stateHub.set('capabilities', payload);
      },
    });

    wireIpc(ctx);

    layout.load();
    seedOneTimeWorkspace();

    {
      const keep = LayoutModel.liveInstanceIds(layout.current());
      const swept = moduleStore.purgeUnused(keep, Date.now(), TRASH_DAYS);
      if (swept.length && isDev) console.log('[trash] swept', swept.length, 'unused settings file(s)');
    }

    syncShellPalette();
    createPopup();
    applyUiScale();
    shortcutActions.prune();
    shortcutActions.apply(settings.get());
    if (typeof ctx.setBareActiveShortcut === 'function') ctx.setBareActiveShortcut(ctx.isShortcutActive());
    if (typeof ctx.setBareCanvasShortcut === 'function') ctx.setBareCanvasShortcut(Boolean(settings.get().bareCanvasOnly));
    applyCommandHotkeys(settings.get().commandBindings);
    buildTray();

    if (!shotPath) refreshUpdateCheck().catch(() => {});

    const verbose = isDev || Boolean(shotPath) || process.argv.includes('--log') || process.argv.includes('--pair');
    if (verbose) {
      service.on('status', (s) => console.log(`[status] ${s.state}${s.detail ? ' - ' + s.detail : ''}`));
      service.on('color', (c) => console.log(`[color] ${c.rgb ? Color.rgbToHex(c.rgb.r, c.rgb.g, c.rgb.b) : '-'} manipulating=${c.manipulating} active=${c.active}`));
    }

    if (!shotPath) {

      startFollowFocus();
      if (settings.get().autoHide) showPopupAuto();
      else showPopup();

      if (process.argv.includes('--whats-new')) {
        if (windows) windows.openWhatsNew();
      } else {
        maybeShowWhatsNew();
      }
    } else {
      showPopup();
    }
    await service.start().catch((err) => console.warn('start:', err.message));

    autoConnectArmed = true;
    scheduleAutoConnect({ immediate: true });
    scheduleAutoUpdateCheck();

    if (process.argv.includes('--pair')) {
      try {
        await startPairing();
        const hex = argValue('--set');
        if (hex) {
          const rgb = Color.hexToRgb(hex);
          if (rgb) {
            service.writeColor(rgb, { immediate: true });
            await new Promise((r) => setTimeout(r, 600));
            await service.readColor();
          }
        }
      } catch (err) {
        console.error('[pair] failed:', err.message);
      }
      if (process.argv.includes('--exit-after')) { quoted = true; app.quit(); }
    }

    app.on('activate', () => showPopup());
  });

  app.on('window-all-closed', () => {  });
  app.on('before-quit', () => {
    quoted = true;

    if (service) service.disconnect().catch(() => {});
  });
  app.on('will-quit', () => {
    stopFollowFocus();
    shortcutActions.stop();
    unregisterCommandHotkeys();

    if (nativeHost) nativeHost.stop();
    stopBand();

    layout.dispose();
  });
}

let cspAccelCache = null;
let cspAccelCacheAt = 0;

/** `{ label, kind }` for the CSP command/tool that owns `accel`, else null. */
function cspOwnerOf(accel) {
  if (!accel || !settings) return null;
  const now = Date.now();
  if (!cspAccelCache || now - cspAccelCacheAt > 15000) {
    try {
      cspAccelCache = cspShortcuts.list({
        root: settings.get().cspDataDir || undefined,
        documents: app.getPath('documents'),
      });
    } catch { cspAccelCache = { commands: [], tools: [] }; }
    cspAccelCacheAt = now;
  }
  return cspAccel.cspOwner(accel, cspAccelCache);
}

module.exports = { DEFAULT_SETTINGS };

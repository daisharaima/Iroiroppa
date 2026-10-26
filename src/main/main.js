'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app, BrowserWindow, Tray, Menu, screen, nativeImage, powerMonitor, protocol,
} = require('electron');

// `theme://` serves a theme's own assets (fonts, images) out of
// <themesDir>/<themeId>/. The scheme must be declared privileged before the app is
// ready so the renderer may load fonts from it under the CSP.
protocol.registerSchemesAsPrivileged([
  { scheme: 'theme', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  // `module://` serves a user module's own script and assets (docs/USER-MODULES.md).
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
const { stopBand } = require('./topmost');
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
const Proof = require('../shared/proof');
const Color = require('../shared/color');
const ModuleManifest = require('../shared/module-manifest');
const LayoutModel = require('../shared/layout-model');
const LayoutGeometry = require('../shared/layout-geometry');
const { createMainCapabilities } = require('./capabilities');
const { createStateHub } = require('./state-hub');
const { createPeerHub } = require('./peer-hub');
const { createSecretStore } = require('./secret-store');
const { createComputeHost } = require('./compute-host');
const { createSettingsService } = require('./settings-service');
const { broadcast: broadcastTo, sendTo, sendToWebContents } = require('./broadcast');
const { createCaptureService } = require('./capture-service');
const { decodeQrFrame } = require('./capture');
const { createSender } = require('./sender');
const cspShortcuts = require('./csp-shortcuts');
const { createMainI18n } = require('./i18n');
const { portableDataDir, usableDataDir } = require('./portable');

// The live capability set; built once Electron is ready.
let capabilities = null;
// The canonical state model and the session/peer layer (docs/STATE.md).
let stateHub = null;
let peerHub = null;
// The utility-process compute host (docs/STATE.md, §6); opt-in.
let computeHost = null;
// The window-capture channel's source enumerator.
let captureService = null;
// The native key sender.
let sender = null;
let contactReadSeq = 0;
// The main-process translator.
let mainI18n = null;

// A portable build keeps its whole state tree beside its .exe instead of in
// %APPDATA% (src/main/portable.js), so a copied folder carries the saved pairing
// and layout with it. This must run before the first `getPath` (the stores below
// resolve it lazily, but the single-instance lock does not) and before `ready`.
const portableDir = portableDataDir();
// Chromium's own `--user-data-dir` (the screenshot recipe, a scripted run) is an
// explicit choice and wins over the portable default.
const explicitUserDataDir = process.argv.some((a) => a === '--user-data-dir' || a.startsWith('--user-data-dir='));
if (portableDir && !explicitUserDataDir) {
  if (usableDataDir(portableDir)) app.setPath('userData', portableDir);
  else console.warn(`[portable] ${portableDir} is not writable; using the usual app-data folder`);
}

// Stores that need only the app-data directory are built once, Electron-free.
// The proof store reads `settings`, which is assigned once Electron is ready, so
// it is given a lazy getter (nothing calls it before then).
const moduleStore = createModuleStore(() => app.getPath('userData'));
const themeStore = createThemeStore(() => app.getPath('userData'));
const workspaceStore = createWorkspaceStore(() => app.getPath('userData'));
// `--user-module <dir>` points the user-module root at a fixture dir (docs/DEV.md),
// so a scripted run can load a module that is not installed under %APPDATA%.
const userModuleArg = (() => {
  const i = process.argv.indexOf('--user-module');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : '';
})();

// `--capture-fake <name>` lists one synthetic capture source, so a `--shot` can
// render the capture module without a desktop (docs/DEV.md).
const captureFakeArg = (() => {
  const i = process.argv.indexOf('--capture-fake');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : '';
})();
const userModuleStore = userModuleArg
  ? createUserModuleStore(null, { modulesDir: () => userModuleArg })
  : createUserModuleStore(() => app.getPath('userData'));
const proofStore = createProofStore({ settings: { get: () => settings.get() } });

// The workspace document. Main owns it and the service is the only thing that
// writes layout.json — atomically, debounced, from one place — so two writers can
// no longer read-modify-write the same file and lose each other's change. See
// docs/LAYOUT.md.
const registry = ModuleManifest.registry();
const layout = createLayoutService({
  store: createLayoutStore(() => app.getPath('userData'), { registry }),
  registry,
});
// The v1 view the board and the float layer still speak (transitional). Unlike the
// old store, a read is never null: the service starts from the default workspace,
// and `hasStoredLayout` tells a first run apart so the board can use its own
// default layout.
const readLayoutDoc = () => layout.v1();
const writeLayoutDoc = (doc) => layout.writeV1(doc).ok;
// Per-palette columns (plan: palette equality) — the board's own read/write, addressed
// by the window's palette id rather than by "the primary".
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
    if (!hasStoredLayout()) return; // a first run gets them from DEFAULT_IDS
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
    // Seeding must never stop the app from starting.
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
  // A float's window is looked up first: after the first palette is deleted or emptied, the
  // palette that is now "first" is a float, and the stale `ctx.popup` must not win.
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

// --- snap groups -------------------------------------------------------------
// Membership is derived from the document (`snap`/`snapTo`), never from a map that a
// join would have to remember to update. A group moves as one and, when resized, its
// shared edge behaves like a splitter (docs/LAYOUT.md, "Snapping").

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
  // Deeper followers keep their size and are simply flushed onto their own anchor.
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
  // Mirror the *v2* document into the canonical model (docs/STATE.md, plan P5). Each window
  // picks its own palette out of it; the domain is no longer the v1 `columns`/`floats`
  // split, which is what made palette 0 special.
  if (stateHub) stateHub.set('layout', ctx.currentWorkspace());
  // Each window also needs its own palette's *state* (name, snap, followers): that is what
  // decides the titlebar's Unsnap icon and keeps a rename in Settings in step. It is not
  // columns, so it travels beside them.
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
    // The board fits its own content now: it grows onto the added module (and shrinks
    // when one leaves), so main must not resize the window behind its back — that would
    // also make the board misread a programmatic resize as a user edge drag.
    return;
  } else if (change.kind === 'content' && change.size) {
    dw = Math.max(0, (Number(change.size.width) || 0) - nowW);
  } else {
    return; // nothing to do (there is no rule for 'grow'; it never had one)
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
    // The primary is `palettes[0]`, and a drop that empties it makes another palette primary.
    // The shell window has to be told, or it keeps drawing the emptied palette's columns and
    // sits there as an empty window (which is exactly what a user sees as "an empty palette
    // appeared"). Rare, so the simplest correct thing: it takes the palette over and reloads.
    syncShellPalette();
    broadcastLayout();
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
  if (first) return; // the boot bind; nothing to rebind
  if (!ctx.popup || ctx.popup.isDestroyed()) return;
  if (ctx.takePrimary) ctx.takePrimary(id); // close it if it had a window of its own
  ctx.popup.reload();
  // The document should describe what is actually on screen: the shell keeps its own geometry,
  // so the palette that just became primary adopts it.
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
      // The box is the *module's* drawn size; the window also needs its chrome now that
      // a float always carries a header and the board's padding (a bare-card float used
      // to have neither). A restored float takes its size from the document instead.
      ctx.openPane(effect.paletteId, box
        ? { width: box.width + 6, height: box.height + 26 }
        : null);
    } else if (effect.type === 'palette.setBounds') {
      // A position the document decides moves the window too: an attach flushes a palette
      // against its anchor (docs/LAYOUT.md, "Snap zones").
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
  // Which sides of a palette already hold one: a palette attached to another takes that side of
  // the anchor and the opposite side of itself, so those zones are neither drawn nor usable
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
  // The window the drag started in is the *last* candidate, not the first: while it is
  // merely near the pointer it would otherwise win the pane lookup and swallow the drop
  // (that is why a module only ever docked when the destination was the palette). Last
  // rather than removed, so a drop back onto itself is still resolved — and refused by
  // the reducer — instead of becoming a new window in empty space.
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
    // Only edges that overlap on the other axis can join, so a palette parked diagonally is free.
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
  // A group moves as a group: every member already moved by the same offset, so an existing join
  // still holds and nothing needs re-evaluating. Without this, dragging a group apart dissolved it.
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
    // A palette drag must not resolve against itself: the pointer sits over the window being
    // dragged (it follows the pointer), so without this the dragged palette is the pane under the
    // cursor and the indicator is drawn on top of it. The whole group is excluded — a release can
    // never dock a palette into itself or into a sibling it is carrying.
    if (payload && payload.kind === 'palette') {
      const skip = new Set([payload.sourcePaletteId]);
      for (const m of payload.members || []) skip.add(m.paletteId);
      return paneList({ source: payload.sourcePaletteId }).filter((p) => !skip.has(p.paletteId));
    }
    return paneList({ source: payload && payload.sourcePaletteId });
  },
  show: (state) => {
    // The resolver's line is in the pane's local CSS px; the overlay wants screen
    // DIP, so convert with that pane's rect and zoom — and the chip's own position
    // is already screen DIP, which showOverlay expects unscaled (zoom 1).
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
    // A dev log, so the next report about a drag has evidence in the app's own output.
    if (isDev) console.log('[drag] ended');
    dragJoinLine = null;
  },
  dispatch: (intent) => applyLayoutIntent(intent),
  // A palette drag moves windows, not modules: main moves them with the pointer (so the move is
  // visible) and settles them on release.
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
    // While a palette is in the air, show the join it would make: the same line, in the same
    // place, as the one the release will commit — on any of the four edges, not just left/right.
    // A group keeps the join it has, so there is nothing to preview for one.
    const me = placed[0];
    const others = paneList().filter((p) => !placed.some((q) => q.paletteId === p.paletteId));
    const join = members.length > 1 ? null : nearestJoin(me, others);
    dragJoinLine = join ? join.line : null;
  },
  settleWindows: (payload, dx, dy) => settleWindowMove(payload, dx, dy),
});
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
// Opt-in only: the input trace exists to diagnose a palette that paints but takes
// no clicks (docs/DEV.md, `--trace-input`).
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
// The palette's size in CSS pixels; its physical size is this × the UI scale.
let popupDesign = null;
let fgWatcher = null;
let fgHealthy = false;
let focusGraceUntil = 0; // ignore blur caused by our own focusability toggling
let hasPositioned = false; // keep the user's position across auto shows
let quoted = false; // true while quitting, so windows don't block
let overlayWin = null;
let overlayState = { text: '', hint: false };
// What each board drew (palette id -> { pad, boxes }), for the drop resolver.
let boardMetrics = new Map();
let moduleSettingsWin = null;
let autoConnectTimer = null;
let autoConnectResumeAt = 0;
// Set once `service.start()` has settled: the saved-connection attempt owns the
// service until then, and a scan started under it would tear that attempt down.
let autoConnectArmed = false;
let popupParked = false;
let parkReleaseAt = 0;
let parkDepth = 0;
let parkOrigin = null;
const floatWins = new Map(); // instanceId -> BrowserWindow
let edgeHintTimer = null;
let lastFollowAt = 0; // when the palette last moved a float with it

const DEFAULT_SETTINGS = Object.freeze({
  liveSync: true,
  historyGate: false, // record a colour only when a canvas contact uses it
  markOutOfDisplay: false, // dim the colours the display cannot show (off: nearest colour)
  autoHide: true,
  autoConnect: true,
  crosshair: true,
  // guide/lock follow the active model's native lightness (see slice-geometry)
  viewFamily: 'all', // all | oklab | cielab | helmgen (future hct)
  hideModuleNames: false,
  locked: false,
  proofProfile: '', // first run resolves the machine's Adobe RGB (1998); see findAdobeRgbProfile()
  proofProfiles: [],
  proofModel: 'working',
  proofMode: 'proof',
  // Where Clip Studio Paint keeps its settings. Empty = the default location
  // (Config.sqlite's custom path, else Documents\CELSYS); see csp-shortcuts.js.
  cspDataDir: '',
  uiScale: 1,
  // Which Settings tab was last open, so the window reopens where the user left it.
  settingsTab: 'appearance',
  theme: 'default-light',
  accents: {}, // per-theme accent overrides: { themeId: '#rrggbb' }
  launchAtLogin: false,
  summonHotkey: '', // a system-wide show/hide key; empty = none (docs/DEV.md)
  commandBindings: {}, // "<instanceId>:<command>" -> accelerator (docs/DEV.md)
  language: '', // '' = follow the system locale
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

// The Settings window's CSS layout width; its physical size scales with the zoom.

// --- windows & focus ---------------------------------------------------------
// The palette, Settings/drag-chip/popout windows, tray and focus watchers live
// in src/main/windows.js (createWindows(ctx)).

// --- floated modules ---------------------------------------------------------
// The pane layer (the palette and every float) lives in src/main/panes.js
// (createPanes(ctx)).

// --- colour history ----------------------------------------------------------

// Main owns the history so every board shares one list: a module floated into
// its own window keeps the history it had in the palette.

const colorHistory = [];
let historyLoaded = false;
let history = null; // its own JsonStore, created in initialize
const HISTORY_MAX = 100; // keep in step with color-store.js

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

// One settle timer for host picks, in main. A renderer's settle timer is
// throttled to ~1 s while its window is hidden, which let an older pick from a
// hidden palette/float land after a newer one (the "previous picked colour"
// bug). Windows only mirror this list (docs/INVARIANTS.md).
const historyRecorder = createHistoryRecorder({
  list: historyList,
  max: HISTORY_MAX,
  save: saveHistory,
  broadcast: broadcastHistory,
});

// The drawing-only gate is a global setting and is enforced here, where the one
// history writer lives; no window keeps gate state of its own (docs/INVARIANTS.md).
const historyGate = createHistoryGate({
  isOn: () => Boolean(settings && settings.get().historyGate === true),
  recorder: historyRecorder,
  currentRgb: () => (service && service.lastColor && service.lastColor.rgb) || null,
  resync: broadcastHistory,
});

// --- module settings popout / auto-connect / focus / tray -------------------
// (those live in src/main/windows.js)

// --- proof profile -----------------------------------------------------------
// Profile discovery lives in the proof store (src/main/proof-profiles.js).
const {
  describeProfileFile, loadProofProfile, findAdobeRgbProfile, findBundledProfile,
  getProof, listProofProfiles, clearCaches: clearProofCaches,
} = proofStore;

// --- themes ------------------------------------------------------------------
// Theme files live in the theme store (src/main/theme-store.js).
const { listThemes, normalizeTheme, themeBackground, themeAssetPath } = themeStore;

// --- per-module settings -----------------------------------------------------
// Per-module settings files live in the module store (src/main/module-store.js).
const { listModuleIds, readModuleSettings, writeModuleSettings, copySettings } = moduleStore;

// --- board layout ------------------------------------------------------------
// layout.json is owned by the layout service (src/main/layout-service.js), which
// holds the workspace document and is the only writer of the file (atomically and
// debounced). `readLayoutDoc`/`writeLayoutDoc`/`findFloatDoc` are its v1 view,
// destructured at the top of this file.

// --- start with Windows ------------------------------------------------------

/** Register or remove the app from the Windows login items. */
function applyLaunchAtLogin(on) {
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: Boolean(on) });
    } else {
      // In development, point the entry at Electron with the app path.
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

// --- update check ------------------------------------------------------------

let updateInfo = { available: false };

/**
 * Ask GitHub for the latest release. It never throws and never surfaces a
 * failure — an unsigned app has nothing useful to say when it is offline, and
 * the comment above each call says so.
 */
async function refreshUpdateCheck() {
  updateInfo = await checkForUpdates({ currentVersion: app.getVersion() });
  broadcast('update:changed', updateInfo);
  return updateInfo;
}

function broadcast(channel, payload) {
  // A window (or only its webContents) can be torn down between the scan and the
  // send; broadcast.js never throws, so a state update is never aborted by one.
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
  // The peer port is the fast path when present; the broadcast is the safety net
  // (docs/STATE.md, §12.4 — authoritative state is still produced by main).
  if (peerHub) {
    for (const p of peerHub.peers()) {
      if (p.port && typeof p.port.postMessage === 'function') {
        try { p.port.postMessage({ type: 'peers', data: peers }); } catch { /* fall back to IPC */ }
      }
    }
  }
  broadcast('peer:peers', peers);
}

/** Renderer intents (docs/STATE.md). There are none yet. */
function applyStateIntent(name) {
  return { ok: false, error: `unknown intent "${name}"` };
}

// --- app context -------------------------------------------------------------

// The mutable main-process state and the shared helpers, exposed to the modules
// extracted from this file (ipc.js now; windows.js/shot.js later). The accessors
// keep this file's own references untouched while letting a module read the live
// window at call time (never a snapshot taken at startup).

const ctx = {
  get capabilities() { return capabilities; },
  get stateHub() { return stateHub; },
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
  get updateInfo() { return updateInfo; },
    get edgeHintTimer() { return edgeHintTimer; },
  set edgeHintTimer(v) { edgeHintTimer = v; },
  get lastFollowAt() { return lastFollowAt; },
  set lastFollowAt(v) { lastFollowAt = v; },

  floatWins, HISTORY_MAX, isDev, paneList,
  // The instance controls (Settings → Modules): main mints the id for a duplicate before
  // the module is mounted, and copies the settings file itself.
  moduleStore, mintInstanceId: (prefix) => layout.newId(prefix),
  paletteDragMembers,
  argValue, shotPath, runShot,
  traceInput,
  shortcutList: () => cspShortcuts.list({
    root: settings.get().cspDataDir || undefined,
    documents: app.getPath('documents'),
  }),
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
  listThemes, normalizeTheme, themeBackground,
  readModuleSettings,
  // Bundled module ids plus the user modules, so the Settings → Modules tab lists both.
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
  // Named saved workspaces (Settings → Layout): main owns the store.
  listNamedWorkspaces: () => workspaceStore.list(),
  getNamedWorkspace: (id) => workspaceStore.get(id),
  saveNamedWorkspace: (name, doc) => workspaceStore.save(name, doc),
  renameNamedWorkspace: (id, name) => workspaceStore.rename(id, name),
  deleteNamedWorkspace: (id) => workspaceStore.remove(id),
  workspaceStore,
  // The same two, callable from main (the shot flags) as from the renderer's IPC.
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

// The pane layer (panes.js) and the windows/focus/tray (windows.js) share the
// live state above; their functions are published on ctx for ipc.js/shot.js, and
// destructured here for this file's own call sites (boot).
const floats = createPanes(ctx);
Object.assign(ctx, floats);
const {
  applyLocked, reopenFloats, showFloats, windowAtPoint, closeFloatWin,
} = floats;

const windows = createWindows(ctx);
Object.assign(ctx, windows);
const {
  createPopup, showPopup, showPopupAuto, applyUiScale, buildTray,
  startFollowFocus, stopFollowFocus, scheduleAutoConnect, startPairing,
  applySummonHotkey, unregisterSummonHotkey, applyCommandHotkeys, unregisterCommandHotkeys,
} = windows;

// --- boot -------------------------------------------------------------------

// A --shot run must never depend on whether the user's app is open. With the
// single-instance lock, a shot launched while Iroiroppa is running would quit
// immediately and the running instance would answer by showing its window — so the
// capture would be the user's own palette, at the user's own size and position
// (this is exactly how `npm run screenshot` once "worked" while producing the wrong
// image). The shot runs its own throwaway instance instead.
if (!shotPath && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (!shotPath) app.on('second-instance', () => showPopup());

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.iroiroppa.app');

    // Serve per-theme assets. The theme id is the host, the rest the path inside
    // the theme folder; themeAssetPath() refuses anything that escapes it.
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

    // Serve a user module's own files (docs/USER-MODULES.md): the module script
    // and any assets it ships. `module://<id>/<rel>` resolves under that module's
    // folder; assetPath() refuses anything that escapes it.
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

    // User modules must be in the layout registry before the workspace document is
    // first read, so a stored layout that places one is not treated as unknown.
    for (const m of userModuleStore.list()) registry[m.id] = { ...m, user: true };
    // The renderer needs the list before it builds the board (its manifest is
    // otherwise bundled-only). It is passed as a window argument, not an IPC call,
    // so a renderer can never block waiting on main (docs/USER-MODULES.md).
    ctx.userModulesArg = `--user-modules=${JSON.stringify(userModuleStore.list())}`;
    // Which state path the renderer consumes (docs/STATE.md). The canonical model
    // is the default now; `--legacy-state` (or `--state=legacy`) falls back.
    const legacyState = process.argv.includes('--legacy-state') || argValue('--state') === 'legacy';
    const stateMode = legacyState ? 'legacy' : 'model';
    ctx.windowArgs = ctx.userModulesArg ? [ctx.userModulesArg] : [];
    ctx.windowArgs.push(`--state-mode=${stateMode}`);

    const dir = app.getPath('userData');
    // New installs default to the machine's Adobe RGB (1998) profile when it has
    // one, else the synthetic ICC the repo ships, so proofing is never dead on
    // arrival. A stored settings.json always wins, so existing installs keep the
    // profile they last used.
    const defaults = { ...DEFAULT_SETTINGS };
    if (!defaults.proofProfile) defaults.proofProfile = findAdobeRgbProfile() || findBundledProfile();
    settings = createSettingsService({ file: path.join(dir, 'settings.json'), defaults, hooks: ctx });
    // The colour history is high-churn and lives in its own file, so a corrupt write
    // cannot cost the preferences too . Migrate once, losslessly, and
    // keep the old copy in settings.json for a downgrade.
    history = new JsonStore(path.join(dir, 'history.json'), { colorHistory: [] });
    if (!fs.existsSync(path.join(dir, 'history.json'))) {
      const saved = settings.get().colorHistory;
      if (Array.isArray(saved) && saved.length) {
        try { fs.copyFileSync(path.join(dir, 'settings.json'), path.join(dir, 'settings.json.pre-history-split.bak')); } catch { /* no settings file yet */ }
        history.set({ colorHistory: saved.map((c) => ({ r: c.r, g: c.g, b: c.b })) });
      }
    }
    // Main-process strings (the tray menu, the file dialogs) are translated too.
    mainI18n = createMainI18n({ language: settings.get().language || '', systemLocale: app.getLocale() });
    // Themes are files now; migrate a stored light/dark id to a theme id once.
    const legacyTheme = settings.get().theme;
    const migratedTheme = normalizeTheme(legacyTheme);
    if (migratedTheme !== legacyTheme) settings.set({ theme: migratedTheme });
    // The old follow-CSP and hide-on-blur options merged into one auto-hide flag.
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
      if (raw && typeof raw.autoHide !== 'boolean' && typeof raw.followCsp === 'boolean') {
        settings.set({ autoHide: raw.followCsp });
      }
    } catch { /* no settings file yet */ }
    // The pairing secret is encrypted at rest with safeStorage (docs/STATE.md,
    // `--no-secret-store` keeps it plaintext (e.g. for the probe).
    const sessionFile = path.join(dir, 'session.json');
    const session = process.argv.includes('--no-secret-store')
      ? new JsonStore(sessionFile, {})
      : createSecretStore({ file: sessionFile, safeStorage: require('electron').safeStorage });
    // Keep the login item in sync with the setting (the exe path can change
    // between runs, and a stale entry should be removed).
    applyLaunchAtLogin(settings.get().launchAtLogin);

    // The canonical state model and the session/peer layer (docs/STATE.md). Both
    // are Electron-free cores given injected IO; main owns the authoritative state
    // and every window mirrors it.
    stateHub = createStateHub({ emit: (channel, payload) => broadcast(channel, payload) });
    const peerBus = !process.argv.includes('--no-peer-bus');
    peerHub = createPeerHub({
      send: (wcId, channel, payload) => {
        const wc = require('electron').webContents.fromId(wcId);
        if (wc && !wc.isDestroyed()) wc.send(channel, payload);
      },
      // A MessagePort pair per window when opted in (docs/STATE.md, §12.4). The
      // port carries transient traffic; the IPC `send` above stays the fallback.
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
    // Observe the storage mode once the hub exists, so a health reader can see it.
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

    // The idle-timer reset that keeps our reads live also keeps CSP's worktime
    // tracker from pausing, so only send it while the palette is on screen and
    // the machine is actually being used (see service._mayKeepHostAwake).
    // The compute host runs heavy work off main (docs/STATE.md, §6). On by
    // default; `--no-compute-host` keeps the decode in main (the `probe` path).
    if (!process.argv.includes('--no-compute-host')) {
      computeHost = createComputeHost({
        // A utilityProcess cannot load a script from inside app.asar reliably; the
        // worker is unpacked (package.json "asarUnpack") so resolve the real path.
        workerPath: path.join(__dirname, 'workers', 'capture-worker.js').replace('app.asar', 'app.asar.unpacked'),
        onEvent: (type, info) => {
          if (isDev && type === 'up') console.log('[compute] host up');
          setHealth({ compute: type });
          if (type === 'down' && peerHub) peerHub.emitEvent('error', { source: 'compute-host', code: info && info.code });
        },
      });
      app.on('will-quit', () => { if (computeHost) computeHost.dispose(); });
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
              // The worker is an optimisation; never let it break pairing.
              if (isDev) console.log('[compute] falling back to in-main decode:', err.message);
              return decodeQrFrame(frame);
            }
          }
        : null,
    });
    service.on('status', (s) => { broadcast('companion:status', s); if (stateHub) stateHub.set('connection', s); setHealth({ csp: s.state }); });
    service.on('color', (c) => { broadcast('companion:color', c); if (stateHub) stateHub.set('color', c); });
    service.on('preview', (p) => {
      for (const win of paletteWindows()) {
        if (win.webContents.id === p.sourceId) continue;
        sendTo(win, 'companion:color-preview', { lab: p.lab, active: p.active });
      }
    });
    service.on('pick', (rgb) => historyGate.onPick(rgb));
    // A left-button release over CSP is the precise end of a pick: take a fresh
    // protocol read and record that colour at once. A left-button down on the CSP
    // canvas is the drawing-only gate's contact; it takes the same fresh read.
    // Skipped under --shot (a screenshot does not need a background hook).
    if (!shotPath) {
      const pointerWatcher = new PointerWatcher();
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
      pointerWatcher.on('up', () => historyGate.onUp(releaseHistory));
      pointerWatcher.on('down', (info) => contactHistory(info));
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
    // One adapter per channel; the companion adapter follows the service (above),
    // and the rest mirror this into every window.
    capabilities = createMainCapabilities({
      service,
      broadcast: (channel, payload) => {
        broadcast(channel, payload);
        if (stateHub && channel === 'capabilities:changed') stateHub.set('capabilities', payload);
      },
    });

    wireIpc(ctx);
    // Read the workspace before any window opens, so the palette and the floats
    // restore from one document.
    layout.load();
    seedOneTimeWorkspace();
    // Settings files for instances that no longer exist are kept for a while (deleting a palette or
    // an instance keeps them, so a mis-click is recoverable) and then swept — the ones inside the
    // window are listed by the Trash section in Settings → Modules.
    {
      const keep = LayoutModel.liveInstanceIds(layout.current());
      const swept = moduleStore.purgeUnused(keep, Date.now(), TRASH_DAYS);
      if (swept.length && isDev) console.log('[trash] swept', swept.length, 'unused settings file(s)');
    }
    // Remember which palette the shell starts on, so the first sync is not a rebind.
    syncShellPalette();
    createPopup();
    applyUiScale();
    applySummonHotkey(settings.get().summonHotkey);
    applyCommandHotkeys(settings.get().commandBindings);
    buildTray();

    // Look for a newer release once, off the Companion path. Skipped for shots so
    // the recipe stays hermetic.
    if (!shotPath) refreshUpdateCheck().catch(() => {});

    const verbose = isDev || Boolean(shotPath) || process.argv.includes('--log') || process.argv.includes('--pair');
    if (verbose) {
      service.on('status', (s) => console.log(`[status] ${s.state}${s.detail ? ' - ' + s.detail : ''}`));
      service.on('color', (c) => console.log(`[color] ${c.rgb ? Color.rgbToHex(c.rgb.r, c.rgb.g, c.rgb.b) : '-'} manipulating=${c.manipulating} active=${c.active}`));
    }

    if (!shotPath) {
      // The watcher tracks the foreground for auto-hide *and* the Companion
      // worktime gate; Auto-hide off only makes its decisions `keep`.
      startFollowFocus();
      if (settings.get().autoHide) showPopupAuto(); // appears without stealing focus; the watcher hides it if CSP is not active
      else showPopup();
    } else {
      showPopup();
    }
    await service.start().catch((err) => console.warn('start:', err.message));
    // The saved attempt is over (connected, or failed and idle); auto-connect owns the
    // service from here. Arm it and look once straight away.
    autoConnectArmed = true;
    scheduleAutoConnect({ immediate: true });

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

  app.on('window-all-closed', () => { /* stay resident in the tray */ });
  app.on('before-quit', () => {
    quoted = true;
    // Close the socket now so CSP frees the single-controller slot promptly.
    if (service) service.disconnect().catch(() => {});
  });
  app.on('will-quit', () => {
    stopFollowFocus();
    unregisterSummonHotkey();
    unregisterCommandHotkeys();
    // Close the long-lived native band helper (topmost.js) before the app exits.
    stopBand();
    // The document is saved on a short debounce; make sure the last change lands.
    layout.dispose();
  });
}

module.exports = { DEFAULT_SETTINGS };

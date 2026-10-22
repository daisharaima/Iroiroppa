'use strict';

// The pane layer: the palette window and every float, their snapping, docking,
// cross-window drops and the transient edge hints — one lifecycle for every window
// (docs/LAYOUT.md, V6). It takes the app context (main.js), so it drives the live
// palette and reads/writes the shared layout through accessors rather than a
// startup snapshot.

const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');
const { resolveWindowBounds } = require('./window-bounds');

function createPanes(ctx) {

  // --- floated modules ---------------------------------------------------------

  // Floats currently collapsed by the eye: their size is not persisted.
  const collapsedFloats = new Set();


/** How close an edge has to be before it snaps flush. */
const SNAP_TOL = 8;

/**
 * Is a float flush with one of the palette's edges? The returned side is the
 * *palette's* edge: 'left' means the float sits to the palette's left, 'top'
 * means it sits above it.
 *//** The opposite side (a float's touching edge is the mirror of the palette's). */
const OPPOSITE_EDGE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

/** Keep a float's size within sane bounds. */
function clampFloatSize(width, height) {
  return {
    width: Math.max(90, Math.min(900, Math.round(width) || 260)),
    height: Math.max(60, Math.min(1400, Math.round(height) || 300)),
  };
}

function nextFloatId(doc) {
  let n = (doc.floats || []).length + 1;
  let id = `f${n}`;
  while ((doc.floats || []).some((f) => f.floatId === id)) { n += 1; id = `f${n}`; }
  return id;
}

/**
 * Open (or focus) a float window for a layout entry. A float is a small board
 * of its own: it can hold several columns of modules, so it behaves like the
 * palette for drops and drags within it.
 */
function openFloatWindow(entry) {
  if (!entry || !entry.floatId) return null;
  const existing = ctx.floatWins.get(entry.floatId);
  if (existing && !existing.isDestroyed()) {
    existing.showInactive();
    return existing.getBounds();
  }

  const size = clampFloatSize(entry.width, entry.height);
  const w = size.width;
  const h = size.height;
  // Sizes in layout.json are CSS pixels; the window is the zoomed physical
  // size, so the UI scale does not compound across launches.
  const zoom = ctx.uiScaleValue();
  const pal = ctx.popup && !ctx.popup.isDestroyed() ? ctx.popup.getBounds() : null;
  let px = Number.isFinite(entry.x) ? Math.round(entry.x) : (pal ? pal.x + pal.width + 6 : NaN);
  let py = Number.isFinite(entry.y) ? Math.round(entry.y) : (pal ? pal.y + 40 + ctx.floatWins.size * 24 : NaN);
  const cursor = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint({
    x: Number.isFinite(px) ? px : cursor.x,
    y: Number.isFinite(py) ? py : cursor.y,
  }).workArea;
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    px = wa.x + wa.width - w - 16;
    py = wa.y + 80;
  } else {
    const visible = px < wa.x + wa.width - 40 && px + w > wa.x + 40
      && py < wa.y + wa.height - 40 && py + h > wa.y + 40;
    if (!visible) { px = wa.x + wa.width - w - 16; py = wa.y + 80; }
  }
  px = Math.max(wa.x + 4, Math.min(px, wa.x + wa.width - w - 4));
  py = Math.max(wa.y + 4, Math.min(py, wa.y + wa.height - h - 4));

  const win = new BrowserWindow({
    x: px,
    y: py,
    width: Math.round(w * zoom),
    height: Math.round(h * zoom),
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 90,
    minHeight: 60,
    focusable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [...(ctx.windowArgs || []), '--palette-id=' + entry.floatId],
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  // This window is not in ctx.floatWins yet, so set its own locked state.
  win.setResizable(ctx.settings.get().locked !== true);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'float.html'), {
    query: { floatId: entry.floatId },
  });
  win.webContents.on('did-finish-load', () => {
    ctx.applyZoom(win);
    win.showInactive();
    // A window is not "moved onto the palette" by being opened: the placement below
    // emits 'move', and the dock-armed timer would otherwise dock a float the instant
    // it appears (over the palette, which is where duplicates land).
    win.__boardLoaded = true;
  });
  if (ctx.isDev || ctx.shotPath || process.argv.includes('--log')) {
    win.webContents.on('console-message', (_e, _l, message) => {
      console.log('[float]', message ?? (_e && _e.message));
    });
  }

  // The snap relationship itself lives in the document (`snap`/`snapTo`); main derives
  // group membership from it, so there is no parallel map to keep in step here.
  // A collapsed float is marked *before* the window exists, so `report` cannot
  // overwrite its saved size with the bar's height.
  if (entry.collapsed) collapsedFloats.add(entry.floatId);

  // Remember the float's geometry directly (main owns layout.json).
  let geo = null;
  const report = () => {
    if (geo) clearTimeout(geo);
    geo = setTimeout(() => {
      geo = null;
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      const z = ctx.uiScaleValue();
      // Geometry is document state, written as one intent (the layout service is
      // the only writer). A collapsed float shows only its bar, so its real size
      // is preserved: `size: null` leaves it alone.
      ctx.dispatchLayout({
        type: 'palette.setBounds',
        paletteId: entry.floatId,
        pos: { x: b.x, y: b.y },
        size: collapsedFloats.has(entry.floatId)
          ? null
          : { width: Math.round(b.width / z), height: Math.round(b.height / z) },
      });
    }, 300);
    geo.unref?.();
  };

  let moveSettleTimer = null; // fires `afterMoveEnd` once a move has stopped
  let lastBounds = win.getBounds();

  win.on('move', () => {
    // Follow the document's snap graph: this pane may be an anchor for another. The
    // drag session moves a whole group itself, so `followSnapGroup` no-ops then.
    // A corner/edge resize also fires `move`; leave the pre-resize rect for the resize
    // handler (which needs it to know which edge moved).
    const moved = win.getBounds();
    if (moved.width === lastBounds.width && moved.height === lastBounds.height) {
      ctx.followSnapGroup(entry.floatId, lastBounds, moved);
      lastBounds = moved;
    }
    // A palette being moved turns into its name chip: the chip follows the pointer while the
    // window is in motion, and goes away when the move ends. (The window itself stays visible —
    // hiding a window mid-move makes Windows drop the move.) The old "hide the contents while
    // it overlaps something" dance is gone: the overlay draws above every window anyway.
    if (win.__boardLoaded) {
      // A palette in motion shows its name chip — but only when *it* is the drag. A lone
      // module's header drags the module, not the window, and that drag's chip (the module's
      // name) is drawn by the drag session; drawing a palette chip here would fight it.
      if (!ctx.dragSession.state()) {
        const at = screen.getCursorScreenPoint();
        const pal = ctx.currentWorkspace().palettes.find((p) => p.id === entry.floatId);
        ctx.showOverlay(null, { text: pal ? pal.name : '', x: at.x, y: at.y, line: null });
      }
      // Main's own placements (a restored position, a fit) also fire 'move'; the quiet timer
      // below is what decides whether the move has ended.
      if (moveSettleTimer) clearTimeout(moveSettleTimer);
      moveSettleTimer = setTimeout(() => { moveSettleTimer = null; afterMoveEnd(); }, 300);
      moveSettleTimer.unref?.();
    }
    // Show which edges are joined while the window is near the palette, but never move
    // it. This used to `setPosition` the window flush on every move, so a float that
    // came near the palette could not be dragged away again ("a strong magnetic
    // force"). Snapping is a constraint you set, not something a move does to you.
    report();
  });
  // A palette drag belongs to the drag session: it moves the windows while the pointer moves and
  // decides move-or-dock on release. So there is nothing to do here but drop a stale hint — this
  // used to dock and join on a timer, which fought the session and could put a window back.
  const afterMoveEnd = () => {
    ctx.hideOverlay();
  };
  win.on('moved', afterMoveEnd);
  win.on('resize', () => {
    const next = win.getBounds();
    // A board's own content fit (`window:resize-self`) already keeps a shared edge
    // pinned in main; don't treat it as a user resize and resize the neighbour.
    const selfResize = Date.now() - (win.__selfResizeAt || 0) < 300;
    if (!selfResize) ctx.reflowSnapResize(entry.floatId, lastBounds, next);
    lastBounds = win.getBounds();
    report();
  });
  win.on('closed', () => {
    if (geo) clearTimeout(geo);
    collapsedFloats.delete(entry.floatId);
    ctx.floatWins.delete(entry.floatId);
  });

  ctx.floatWins.set(entry.floatId, win);
  // A new palette is *not* automatically joined to the palette it happens to land beside —
  // joining is an explicit gesture now: drop it in a snap zone (docs/LAYOUT.md, "Snap zones").
  // The old proximity snap (`snapEdge`) and this open-time detection are both gone with it.
  return win.getBounds();
}
/** Close a float window without touching layout.json. */
function closeFloatWin(floatId) {
  const win = ctx.floatWins.get(floatId);
  ctx.floatWins.delete(floatId);
  collapsedFloats.delete(floatId);
  if (win && !win.isDestroyed()) win.close();
  // A float can be closed while one of its modules is being dragged (a lone
  // module dragged onto the palette); the chip would otherwise stay on screen.
  ctx.hideOverlay();
}

/** How many modules a float holds (a lone-module float has no dock-on-hover). */
function floatModuleCount(floatId) {
  const f = ctx.findFloatDoc(floatId);
  if (!f) return 0;
  let n = 0;
  for (const col of f.columns || []) n += (col.modules || []).length;
  return n;
}

/** Remember whether a float is collapsed, so its size is not persisted. The
 *  document is the truth, so a collapsed float reopens collapsed. */
function setFloatCollapsed(floatId, collapsed) {
  if (!floatId) return false;
  if (collapsed) collapsedFloats.add(floatId);
  else collapsedFloats.delete(floatId);
  ctx.dispatchLayout({
    type: 'palette.setCollapsed',
    paletteId: floatId,
    collapsed: Boolean(collapsed),
  });
  return Boolean(collapsed);
}

/** Is this float collapsed? (A UI-scale change must not expand it.) */
function isFloatCollapsed(floatId) {
  return collapsedFloats.has(floatId);
}

/**
 * Open the window for a palette the document says exists (docs/LAYOUT.md, V6). The
 * effects are the only thing that opens a window now — the renderer never asks for
 * a float; it changes the document and the window follows.
 *
 * `size` is the box the module was drawn in, which is what the old float:add path
 * measured for itself.
 */
function openPane(paletteId, size) {
  if (!paletteId) return null;
  if (paletteId === ctx.primaryPaletteId()) return ctx.popup || null; // the palette is already up
  const existing = ctx.floatWins.get(paletteId);
  if (existing && !existing.isDestroyed()) return existing;
  const doc = ctx.readLayoutDoc();
  const entry = (doc.floats || []).find((f) => f.floatId === paletteId);
  if (!entry) return null;
  if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) {
    const clamped = clampFloatSize(size.width, size.height);
    entry.width = clamped.width;
    entry.height = clamped.height;
  }
  return openFloatWindow(entry);
}

/** Close the window for a palette that is gone. The palette window itself only hides. */
function closePane(paletteId) {
  if (!paletteId || paletteId === ctx.primaryPaletteId()) return;
  closeFloatWin(paletteId);
}

/** The shell window has taken this palette over (it became the primary): close the window that
 *  was showing it as a float, so the same palette is not on screen twice. */
function takePrimary(paletteId) {
  if (!paletteId) return;
  closeFloatWin(paletteId);
}

/** Forget a float entirely (layout entry and window). */
function removeFloat(floatId) {
  closeFloatWin(floatId);
  const doc = ctx.readLayoutDoc();
  if (!doc) return;
  doc.floats = doc.floats.filter((f) => f.floatId !== floatId);
  ctx.writeLayoutDoc(doc);
}

/** Create a float holding one module and show it. */
function addFloat(spec = {}) {
  const { moduleId, instanceId } = spec;
  if (!moduleId) return null;
  // No `|| { columns: [] }` fallback: the read is never null now (the layout
  // service always has a document), and writing an empty one would wipe the board.
  const doc = ctx.readLayoutDoc();
  const floatId = nextFloatId(doc);
  const size = clampFloatSize(spec.width, spec.height);
  const entry = {
    floatId,
    x: Number.isFinite(spec.x) ? Math.round(spec.x) : null,
    y: Number.isFinite(spec.y) ? Math.round(spec.y) : null,
    width: size.width,
    height: size.height,
    snap: null,
    columns: [{
      id: `${floatId}c1`,
      width: null,
      modules: [{ instanceId: instanceId || `${floatId}m1`, moduleId, weight: null }],
    }],
  };
  doc.floats.push(entry);
  ctx.writeLayoutDoc(doc);
  openFloatWindow(entry);
  return entry;
}

/** The window (palette or a float) under a screen point, if any. `exclude` skips
 *  the window that is being dragged: it overlaps the palette while its module is
 *  handed over, and must not be mistaken for the drop target. */
function windowAtPoint(x, y, exclude) {
  for (const [floatId, win] of ctx.floatWins) {
    if (win.isDestroyed() || win === exclude) continue;
    const b = win.getBounds();
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
      return { kind: 'float', floatId, win, bounds: b };
    }
  }
  if (ctx.popup && !ctx.popup.isDestroyed() && ctx.popup !== exclude) {
    const b = ctx.popup.getBounds();
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
      return { kind: 'popup', win: ctx.popup, bounds: b };
    }
  }
  return null;
}

/**
 * A drag released outside its window: hand the module to whatever window is
 * under the pointer (the palette or another float), or report that it should be
 * floated on its own. A drop back onto the source window is refused, so a module
 * dragged onto its own board is never removed from it.
 */
/** Take one module out of a float; the palette adopts it. */
/**
 * Move modules out of one palette and into another, through the one intent — the same path
 * a drag takes.
 *
 * This used to write the whole v1 document and then hand each module to the target's board
 * over `module:accept`, which re-added it with a *new* instance id: docking a module created
 * a duplicate of it (and a stray palette holding the copy). That is the bug that multiplied
 * instances across sessions.
 */
function dockThroughIntent(floatId, targetPaletteId, side, onlyInstanceId) {
  const doc = ctx.currentWorkspace();
  const from = (doc.palettes || []).find((p) => p.id === floatId);
  if (!from) return false;
  const all = from.columns.flatMap((c) => c.modules.map((m) => m.instanceId));
  const items = onlyInstanceId ? all.filter((id) => id === onlyInstanceId) : all;
  if (!items.length) return false;
  // A docked palette brings its own window size with it (docs/LAYOUT.md, "Snapping"): docking
  // whole, it grows the destination by its width (rows beside) or its height (a column of rows).
  // A single module has no window of its own to measure, so let the card's measurement stand.
  let grown;
  const win = floatWinFor(floatId);
  if (win && !win.isDestroyed() && !onlyInstanceId) {
    const b = win.getBounds();
    const z = (win.webContents && win.webContents.getZoomFactor && win.webContents.getZoomFactor()) || 1;
    grown = { width: b.width / z, height: b.height / z };
  }
  const out = ctx.applyLayoutIntent({
    type: 'layout.place',
    sourcePaletteId: floatId,
    items,
    target: { kind: 'outer', paletteId: targetPaletteId, side: side === 'left' ? 'left' : 'right' },
    grown,
  });
  return Boolean(out && out.ok);
}

/**
 * Dock one module of a float into the first palette (the float's Dock button). Any palette
 * is a valid destination now; the button has no pointer to resolve against, so it uses the
 * first — the drag path (`dockFloatAt`) resolves the one under the pointer.
 * Deferred (plan P8): whether the button should use the last-focused palette instead is a
 * UX call, not a correctness one.
 */
function dockFloatModule({ floatId, instanceId } = {}) {
  return dockThroughIntent(floatId, ctx.primaryPaletteId(), 'right', instanceId);
}

/** Return every module in a float to the palette and close the window. */
function dockFloatAll(floatId) {
  return dockThroughIntent(floatId, ctx.primaryPaletteId(), 'right');
}

/** Show (or clear) the dock indicator in a target window (palette or float). *//**
 * Dock a whole palette onto a target window at a screen point — through the one intent, like
 * every other move. Which side it lands on is the side the pointer is nearest, so "drop it
 * there" means what it says.
 *
 * The old version read the source's layout out of its *renderer* (`executeJavaScript`) and
 * then pushed `columns` at the target's board, which is why it could disagree with the
 * document and why it re-created instances. The document is the truth now.
 */
async function dockFloatAt(floatId, at, target) {
  const sourceWin = ctx.floatWins.get(floatId);
  let t = target;
  if (!t || !t.win || t.win.isDestroyed()) t = windowAtPoint(at.x, at.y, sourceWin);
  if (!t || !t.win || t.win.isDestroyed()) return false;
  const targetId = t.kind === 'popup' ? ctx.primaryPaletteId() : t.floatId;
  if (!targetId || targetId === floatId) return false;
  const b = t.win.getBounds();
  const side = (at.x - b.x) < b.width / 2 ? 'left' : 'right';
  return dockThroughIntent(floatId, targetId, side);
}

/** Resolve a --dock/--float-near argument: a float id or a module instance id. */
function floatWinFor(id) {
  const direct = ctx.floatWins.get(id);
  if (direct) return direct;
  const doc = ctx.readLayoutDoc();
  const f = doc && doc.floats.find((x) => (x.columns || []).some(
    (col) => (col.modules || []).some((m) => m.instanceId === id),
  ));
  return f ? ctx.floatWins.get(f.floatId) : null;
}

/** Show or hide every float alongside the palette. */
function showFloats(show) {
  for (const win of ctx.floatWins.values()) {
    if (win.isDestroyed()) continue;
    if (show) win.showInactive();
    else win.hide();
  }
}

/** Reopen the floats saved in layout.json (once, at startup). */
function reopenFloats() {
  const doc = ctx.readLayoutDoc();
  if (!doc) return;
  for (const f of doc.floats) openFloatWindow(f);
}

/**
 * Nudge every live float window back into a work area that still exists — a
 * monitor was unplugged or reconfigured — so a floated module can never be
 * stranded off-screen. Also used by the tray's "Bring floats back" action.
 */
function reclampFloats() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  let moved = false;
  for (const [, win] of ctx.floatWins) {
    if (win.isDestroyed()) continue;
    const b = win.getBounds();
    const display = screen.getDisplayMatching(b);
    const fixed = resolveWindowBounds(
      { x: b.x, y: b.y, displayId: display.id },
      { width: b.width, height: b.height },
      displays, null, primary, { width: 90, height: 60 },
    );
    if (fixed.x !== b.x || fixed.y !== b.y
      || fixed.width !== b.width || fixed.height !== b.height) {
      win.setBounds({ x: fixed.x, y: fixed.y, width: fixed.width, height: fixed.height });
      moved = true;
    }
  }
  return moved;
}

/** Locking the layout also freezes the windows' sizes. */
function applyLocked(locked) {
  if (ctx.popup && !ctx.popup.isDestroyed()) ctx.popup.setResizable(!locked);
  for (const win of ctx.floatWins.values()) {
    if (!win.isDestroyed()) win.setResizable(!locked);
  }
}

  return {
    clampFloatSize, nextFloatId, openFloatWindow,
    closeFloatWin, floatModuleCount, removeFloat, addFloat, openPane, closePane, takePrimary,
    windowAtPoint, dockFloatModule, dockFloatAll, dockFloatAt, floatWinFor, showFloats,
    reopenFloats, reclampFloats, setFloatCollapsed, isFloatCollapsed, applyLocked,
  };
}

module.exports = { createPanes };

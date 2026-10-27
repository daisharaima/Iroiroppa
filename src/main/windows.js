'use strict';

// The windows and OS-level watchers: the palette popup, the Settings and
// module-settings windows, the drag chip, the tray, and the focus/auto-connect
// watchers. It takes the app context (main.js) so it drives the live windows and
// reads the shared state through accessors.

const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, screen, nativeImage, globalShortcut } = require('electron');
const { resolveWindowBounds } = require('./window-bounds');
const { attachRendererRecovery } = require('./renderer-recovery');
const { ForegroundWatcher } = require('./foreground');
const { focusAction } = require('./focus-policy');
const { overlayBounds } = require('./overlay-bounds');
const { menuBox } = require('./overlay-menu-box');
const { drawIcon, rgbaToBgra } = require('../shared/icon-art');
const { sendTo } = require('./broadcast');
const { ensureBand, ensureTopmost } = require('./topmost');

const SETTINGS_WIDTH = 360;

function createWindows(ctx) {
  /**
   * Re-assert the topmost band after a show. Normally the runtime does it from
   * `alwaysOnTop`; on a Windows/Electron combination where that request is
   * dropped, src/main/topmost.js sets the flag with SetWindowPos instead. It is
   * a no-op once the window reports itself on top.
   */
  const raiseTopmost = (win) => { ensureTopmost(win).catch(() => {}); };
  // The palette/float band: topmost *and* out of the activation path (topmost.js).
  const raiseBand = (win, opts = {}) => { ensureBand(win, { noActivate: true, ...opts }).catch(() => {}); };

  // Window order follows the user: a focus (Settings, the popout) or a show (a palette
  // coming back, the overlay menu opening) makes that window the one to raise.
  app.on('browser-window-focus', (_event, win) => { if (win && !win.isDestroyed()) ctx.lastInteracted = win; });
  app.on('browser-window-created', (_event, win) => {
    win.on('show', () => { if (!win.isDestroyed()) ctx.lastInteracted = win; });
  });

  // --- the band watchdog + visibility trace ----------------------------------

  let bandTimer = null;

  /**
   * Chromium rewrites a window's extended style when it tries to activate it on a
   * click, which drops WS_EX_TOPMOST; the press path repairs that at once, and this
   * half-second check catches any other drop (a show, a DPI change, a runtime
   * hiccup). Without it a palette that left the topmost band stayed behind another
   * always-on-top tool until the next show — the "randomly disappears" report.
   */
  function startBandWatch() {
    if (bandTimer) return;
    bandTimer = setInterval(() => {
      const wins = [];
      if (ctx.popup && !ctx.popup.isDestroyed() && ctx.popup.isVisible()) wins.push(ctx.popup);
      for (const win of (ctx.floatWins ? ctx.floatWins.values() : [])) {
        if (win && !win.isDestroyed() && win.isVisible()) wins.push(win);
      }
      // Our own tool windows join the same list: order now follows the user, not a
      // fixed "tools last" rule.
      for (const tool of [ctx.moduleSettingsWin, ctx.settingsWin, ctx.overlayWin]) {
        if (tool && !tool.isDestroyed() && tool.isVisible()) wins.push(tool);
      }
      // Order follows the user: every band window's *bit* is repaired without touching
      // the z-order (`zorder:false`), and only the window the user touched last is
      // raised. A fixed "tools last" order made Settings permanently outrank a palette
      // (and vice versa); a plain `SetWindowPos(HWND_TOPMOST)` per window every 500 ms
      // made the palette flash over Settings (the "palette flashes on top then goes
      // behind" report).
      for (const win of wins) raiseBand(win, { zorder: false });
      raiseInteracted();
      if (!wins.length) stopBandWatch();
    }, 500);
    if (bandTimer.unref) bandTimer.unref();
  }

  function stopBandWatch() {
    if (!bandTimer) return;
    clearInterval(bandTimer);
    bandTimer = null;
  }

  /** `--trace-input`: record every visibility change with its reason, so a
   *  "disappeared" report can be told apart from one that was only covered. */
  function traceVisibility(action) {
    if (!ctx.traceInput) return;
    try {
      ctx.traceInput({
        type: 'visibility',
        action,
        visible: Boolean(ctx.popup && !ctx.popup.isDestroyed() && ctx.popup.isVisible()),
        foreground: ctx.fgName || '',
        autoHide: ctx.settings.get().autoHide !== false,
      });
    } catch { /* tracing only */ }
  }
// --- window -----------------------------------------------------------------

// Auto-hide diagnostics (`--trace-focus`): the foreground stream, the decision,
// the confirming re-query and any cancel. This is how a "hidden while CSP is
// focused" report is proven fixed rather than guessed at.
const focusTrace = process.argv.includes('--trace-focus');
const traceFocus = (...args) => { if (focusTrace) console.log('[focus]', ...args); };
function createPopup() {
  const sizeArg = ctx.argValue('--size');
  const fallback = { width: 260, height: 640 };
  // The size is stored — and set with --size — in CSS pixels; the physical
  // window grows with the UI scale. `windowBounds` carries a CSS-pixel size and
  // the display it was on; the older `windowSize`/`windowPos` keys migrate in.
  // The document is the source of truth now; `windowBounds` in settings.json is
  // legacy and only read when the document has nothing (see docs/LAYOUT.md).
  const remembered = ctx.primaryPlacement() || ctx.settings.get().windowBounds || {};
  const legacySize = ctx.settings.get().windowSize;
  const legacyPos = ctx.settings.get().windowPos;
  const savedSize = Number.isFinite(remembered.width) && Number.isFinite(remembered.height)
    ? remembered
    : legacySize;
  let cssW = fallback.width;
  let cssH = fallback.height;
  if (sizeArg && /^\d+x\d+$/.test(sizeArg)) {
    [cssW, cssH] = sizeArg.split('x').map(Number);
  } else if (savedSize && Number.isFinite(savedSize.width) && Number.isFinite(savedSize.height)) {
    cssW = Math.max(200, Math.min(900, Math.round(savedSize.width)));
    cssH = Math.max(340, Math.min(1400, Math.round(savedSize.height)));
  }
  const scale = uiScaleValue();
  // The display comes from the remembered display id (else the cursor, else the
  // primary) and the window is clamped into its work area — so a second monitor
  // is restored, and an unplugged one cannot strand the window off-screen.
  const resolved = resolveWindowBounds(
    {
      x: Number.isFinite(remembered.x) ? remembered.x : legacyPos && legacyPos.x,
      y: Number.isFinite(remembered.y) ? remembered.y : legacyPos && legacyPos.y,
      displayId: remembered.displayId,
    },
    { width: cssW * scale, height: cssH * scale },
    screen.getAllDisplays(),
    screen.getCursorScreenPoint(),
    screen.getPrimaryDisplay()
  );
  ctx.popupDesign = { width: Math.max(200, Math.round(resolved.width / scale)), height: Math.max(340, Math.round(resolved.height / scale)) };
  const winW = resolved.width;
  const winH = resolved.height;
  ctx.popup = new BrowserWindow({
    width: winW,
    height: winH,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 200,
    minHeight: 340,
    // A non-activating window: clicking the palette must not take focus away
    // from Clip Studio Paint. Text fields re-enable focus while editing.
    // Activatable on purpose: on Windows 26300 a press on a window Chromium
    // considers non-activatable never reaches the page (only the move and the
    // release do). The window is kept out of the activation path natively instead
    // — WS_EX_NOACTIVATE from topmost.ps1 — so a click still leaves CSP focused.
    focusable: true,
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
      backgroundThrottling: false,
      additionalArguments: [...(ctx.windowArgs || []), '--palette-id=' + (ctx.primaryPaletteId() || '')],
      sandbox: false,
    },
  });

  ctx.popup.setAlwaysOnTop(true, 'floating');
  attachRendererRecovery(ctx.popup, 'palette');
  ctx.popup.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Electron drops a zoom applied before the page loads; re-apply it once loaded.
  ctx.popup.webContents.on('did-finish-load', () => applyZoom(ctx.popup));

  // Restore the position the user last left it at (if any). With no memory the
  // first-run placement in positionPopup() centres under the cursor.
  if (resolved.hadPosition) {
    ctx.popup.setPosition(resolved.x, resolved.y, false);
    ctx.hasPositioned = true;
  }

  if (ctx.isDev || ctx.shotPath || process.argv.includes('--log')) {
    ctx.popup.webContents.on('console-message', (_e, level, message) => {
      console.log('[renderer]', message ?? (_e && _e.message));
    });
  }

  if (ctx.shotPath) ctx.runShot(ctx);

  // A collapsed palette comes up as a bar. The document is authoritative, and waiting for the
  // renderer to apply its own state races the resize handler — which then remembers the expanded
  // size and reports the flag back as false. Main applies it before the window is in use.
  {
    const pal = ctx.layoutPalette(ctx.primaryPaletteId());
    if (pal && pal.collapsed) {
      ctx.popup.setMinimumSize(200, 20);
      ctx.popup.setContentSize(Math.round(ctx.popupDesign.width * scale), Math.max(20, Math.round(24 * scale)));
    }
  }

  ctx.popup.on('blur', () => {
    if (ctx.isDev || ctx.shotPath) return;
    const s = ctx.settings.get();
    if (!s.autoHide) return;
    // The foreground watcher owns visibility. A blur is not proof that CSP lost
    // focus: a text field, the module-settings popout or the palette menu all
    // blur the palette while CSP is still the foreground. Hiding here was the
    // "auto-hide hides while CSP is focused" bug. If the watcher is down the
    // palette stays up; a broken watcher must never guess.
    traceFocus('blur ignored (watcher owns visibility)', {
      healthy: Boolean(ctx.fgHealthy),
    });
  });
  ctx.popup.on('close', (e) => {
    if (!ctx.quoted) {
      e.preventDefault();
      hidePopup();
    }
  });

  // Remember the last window size (CSS pixels) across launches.
  let sizeSaveTimer = null;
  let lastPaletteBounds = ctx.popup.getBounds();
  const trackMove = () => {
    const pal = ctx.popup.getBounds();
    // A corner/edge resize fires `move` too; the resize handler must still see the
    // pre-resize rect, so only a pure move advances the remembered bounds.
    if (pal.width === lastPaletteBounds.width && pal.height === lastPaletteBounds.height) {
      ctx.followSnapGroup(ctx.primaryPaletteId(), lastPaletteBounds, pal);
      lastPaletteBounds = pal;
    }
  };
  /** A resize of a snapped palette moves the shared edge; reflow the pair. */
  const trackResize = () => {
    const pal = ctx.popup.getBounds();
    ctx.reflowSnapResize(ctx.primaryPaletteId(), lastPaletteBounds, pal);
    lastPaletteBounds = pal;
  };
  /**
   * Remember where and how big the palette is, and which display it was on, so
   * it reopens there. Called (debounced) on move and resize. It goes into the
   * workspace document — the single writer keeps it, and `settings.json#
   * windowBounds` is legacy from here on.
   */
  const saveWindowPlacement = () => {
    if (!ctx.popup || ctx.popup.isDestroyed()) return;
    const [x, y] = ctx.popup.getPosition();
    const display = screen.getDisplayMatching(ctx.popup.getBounds());
    // The size is the *design* size, never the live one: while the palette is collapsed the live
    // height is just the titlebar and must not become the palette's remembered size.
    const collapsed = (() => {
      const p = ctx.layoutPalette(ctx.primaryPaletteId());
      return Boolean(p && p.collapsed);
    })();
    const size = collapsed
      ? null
      : (ctx.popupDesign || fallback);
    const paletteId = ctx.primaryPaletteId();
    if (!paletteId) return;
    ctx.dispatchLayout({
      type: 'palette.setBounds',
      paletteId,
      pos: { x, y, displayId: display.id },
      size: { width: size.width, height: size.height },
    });
  };

  ctx.popup.on('resize', () => {
    // A park (or the DPI change from crossing monitors while parked) resizes the
    // window; that is not the user's size and must not be remembered either.
    if (ctx.popupParked || Date.now() < ctx.parkReleaseAt) return;
    trackResize();
    // A user resize (dragging the window edges) does not go through
    // window:resize, so keep the CSS-pixel design size in step here — otherwise
    // opening Settings re-applies the old size and undoes the resize.
    // A collapse shrinks the window to its titlebar. That height is not the palette's own, so it
    // must never be remembered — the float's collapse has the same guard in panes.js. Without it
    // the palette saved 340 px (the `Math.max` clamp below) and reopened as a bar with a band of
    // empty space under it, which is the "weird collapsed state" a user reported.
    const collapsedNow = () => {
      const p = ctx.layoutPalette(ctx.primaryPaletteId());
      return Boolean(p && p.collapsed);
    };
    if (!collapsedNow() && ctx.popupDesign) {
      const z = ctx.popup.webContents.getZoomFactor() || 1;
      const [cw, ch] = ctx.popup.getContentSize();
      ctx.popupDesign = {
        width: Math.max(200, Math.min(900, Math.round(cw / z))),
        height: Math.max(340, Math.min(1400, Math.round(ch / z))),
      };
    }
    if (sizeSaveTimer) clearTimeout(sizeSaveTimer);
    sizeSaveTimer = setTimeout(() => {
      if (!ctx.popup || ctx.popup.isDestroyed() || ctx.popup.isMinimized() || !ctx.popupDesign) return;
      if (ctx.popupParked || Date.now() < ctx.parkReleaseAt || collapsedNow()) return;
      saveWindowPlacement();
    }, 400);
    sizeSaveTimer.unref?.();
  });

  if (ctx.isDev) ctx.popup.webContents.openDevTools({ mode: 'detach' });

  // Remember the last window position across launches.
  let moveSaveTimer = null;
  ctx.popup.on('move', () => {
    // A scan temporarily parks the palette off the QR; that position is not the
    // user's, so never remember it (or drag floats after it).
    if (ctx.popupParked || Date.now() < ctx.parkReleaseAt) return;
    trackMove();
    // Mark any joined edges while the palette is being dragged.
    if (moveSaveTimer) clearTimeout(moveSaveTimer);
    moveSaveTimer = setTimeout(() => {
      if (!ctx.popup || ctx.popup.isDestroyed() || ctx.popupParked || Date.now() < ctx.parkReleaseAt) return;
      saveWindowPlacement();
    }, 400);
    moveSaveTimer.unref?.();
  });

  // A monitor being unplugged (or reconfigured) must not strand the palette
  // off-screen: clamp the live window into a work area that still exists.
  const reclamp = () => {
    if (!ctx.popup || ctx.popup.isDestroyed()) return;
    const b = ctx.popup.getBounds();
    const display = screen.getDisplayMatching(b);
    const start = { x: b.x, y: b.y, displayId: display.id };
    const fixed = resolveWindowBounds(start, { width: b.width, height: b.height }, screen.getAllDisplays(), null, screen.getPrimaryDisplay());
    if (fixed.x !== b.x || fixed.y !== b.y || fixed.width !== b.width || fixed.height !== b.height) {
      ctx.popup.setBounds({ x: fixed.x, y: fixed.y, width: fixed.width, height: fixed.height });
    }
  };
  screen.on('display-removed', reclamp);
  screen.on('display-added', reclamp);
  screen.on('display-metrics-changed', reclamp);

  // Reopen the float boards that were on screen last time.
  ctx.applyLocked(ctx.settings.get().locked === true);
  ctx.reopenFloats();

  return ctx.popup;
}

/**
 * Open (or focus) the Settings window. It is a separate, freely resizable
 * window so the options stay usable when the palette itself is small.
 */
function createSettingsWindow() {
  if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) {
    ctx.settingsWin.show();
    ctx.settingsWin.focus();
    return ctx.settingsWin;
  }
  ctx.settingsWin = new BrowserWindow({
    width: 360,
    height: 480,
    minWidth: 300,
    minHeight: 200,
    show: false,
    frame: false,
    resizable: true,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#f2f4f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ctx.windowArgs || [],
      sandbox: false,
    },
  });
  ctx.settingsWin.setAlwaysOnTop(true, 'floating');
  ctx.settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  // Zoom has to be (re)applied after load; this also re-sizes the window to the
  // scaled width and lets the renderer re-fit its height.
  ctx.settingsWin.webContents.on('did-finish-load', () => applyUiScale());
  ctx.settingsWin.once('ready-to-show', () => ctx.settingsWin.show());
  ctx.settingsWin.on('closed', () => { ctx.settingsWin = null; });
  applyUiScale();
  applyWindowTheme();
  if (ctx.isDev || ctx.shotPath || process.argv.includes('--log')) {
    ctx.settingsWin.webContents.on('console-message', (_e, _l, message) => {
      console.log('[settings]', message ?? (_e && _e.message));
    });
  }
  return ctx.settingsWin;
}

/**
 * Show the palette. It never takes focus (the window is non-activating), so
 * clicking it does not pull focus away from Clip Studio Paint.
 */
function showPopup() {
  resetInputState();
  if (!ctx.popup) createPopup();
  if (ctx.popup && !ctx.popup.isDestroyed() && ctx.popup.webContents.isCrashed()) {
    try { ctx.popup.webContents.reload(); } catch { /* recovery already scheduled */ }
  }
  // Position only the first time; afterwards remember where the user put it.
  if (!ctx.hasPositioned) {
    positionPopup();
    ctx.hasPositioned = true;
  }
  if (ctx.popup && !ctx.popup.isDestroyed()) ctx.popup.showInactive();
  raiseBand(ctx.popup);
  startBandWatch();
  traceVisibility('show');
  ctx.showFloats(true);
  if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) ctx.settingsWin.showInactive();
  raiseTopmost(ctx.settingsWin);
  // A palette that just appeared is the moment to look for the QR, not the next timer tick.
  scheduleAutoConnect({ immediate: true });
}

/** Show without marking as a manual show (used by focus-follow). */
function showPopupAuto() {
  resetInputState();
  if (!ctx.popup) createPopup();
  if (ctx.popup && !ctx.popup.isDestroyed() && ctx.popup.webContents.isCrashed()) {
    try { ctx.popup.webContents.reload(); } catch { /* recovery already scheduled */ }
  }
  // Keep wherever the user last put it; only place it the first time.
  if (!ctx.hasPositioned) {
    positionPopup();
    ctx.hasPositioned = true;
  }
  if (ctx.popup && !ctx.popup.isDestroyed()) ctx.popup.showInactive();
  raiseBand(ctx.popup);
  startBandWatch();
  traceVisibility('show');
  ctx.showFloats(true);
  if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) ctx.settingsWin.showInactive();
  raiseTopmost(ctx.settingsWin);
  scheduleAutoConnect({ immediate: true });
}

function hidePopup() {
  // The palette menu is drawn by the overlay: it must not outlive the palette.
  closeOverlayMenu();
  closeModuleSettingsWindow();
  ctx.showFloats(false);
  // The Settings window goes away with the palette and returns with it.
  if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) ctx.settingsWin.hide();
  if (ctx.popup && !ctx.popup.isDestroyed()) ctx.popup.hide();
  stopBandWatch();
  traceVisibility('hide');
}

/**
 * First-run placement only: centred on the monitor the cursor is on. After
 * that the position is remembered (ctx.settings.windowBounds) and never overridden.
 */
function positionPopup() {
  if (!ctx.popup) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  const [w, h] = ctx.popup.getSize();
  const px = Math.round(x + (width - w) / 2);
  const py = Math.round(y + (height - h) / 2);
  ctx.popup.setPosition(px, py, false);
}

function togglePopup() {
  if (ctx.popup && ctx.popup.isVisible()) hidePopup();
  else showPopup();
}

/**
 * Clear every transient input owner before showing the palette: a menu, the
 * module-settings popout, or a pointer capture left over from a drag can
 * otherwise swallow the next click. This is deliberately separate from colour
 * state; it only restores the input layer.
 */
function resetInputState() {
  closeOverlayMenu();
  hideOverlay();
  closeModuleSettingsWindow();
  const wins = [];
  if (ctx.popup && !ctx.popup.isDestroyed()) wins.push(ctx.popup);
  for (const win of (ctx.floatWins ? ctx.floatWins.values() : [])) {
    if (win && !win.isDestroyed()) wins.push(win);
  }
  for (const win of wins) {
    try { win.setEnabled(true); } catch { /* closing */ }
    // The band is re-applied on every show: the window may have been hidden and
    // re-shown, and Chromium drops the topmost bit when it rewrites the style.
    raiseBand(win);
    sendTo(win, 'input:reset');
  }
  if (process.argv.includes('--trace-input') || ctx.traceInput) {
    for (const win of wins) {
      try {
        if (ctx.traceInput) {
          ctx.traceInput({
            type: 'window',
            label: win === ctx.popup ? 'palette' : 'float',
            visible: win.isVisible(),
            focused: win.isFocused(),
            enabled: win.isEnabled(),
            focusable: win.isFocusable(),
            alwaysOnTop: win.isAlwaysOnTop(),
            bounds: win.getBounds(),
          });
        }
      } catch { /* closing */ }
    }
    console.log('[input] reset', { windows: wins.length, overlay: Boolean(ctx.overlayWin && !ctx.overlayWin.isDestroyed()) });
  }
}

// --- the native band (topmost + non-activating) -------------------------------

/**
 * Repair the band after a press. Chromium rewrites the window's extended style when
 * it tries to activate on a click, and that drops WS_EX_TOPMOST — the palette then
 * sits behind any other topmost window until the next show (the "it disappears"
 * report). The repair goes through the long-lived helper (topmost.js), so it costs a
 * few microseconds: no PowerShell spawn, no foreground flash, no frame recalc.
 * `moveTop()` is never used here — SetWindowPos(HWND_TOP) itself removes the
 * topmost bit.
 */
function reassertBand(webContents) {
  const wins = [];
  if (ctx.popup && !ctx.popup.isDestroyed()) wins.push(ctx.popup);
  for (const win of (ctx.floatWins ? ctx.floatWins.values() : [])) {
    if (win && !win.isDestroyed()) wins.push(win);
  }
  for (const win of wins) {
    // Only for the window that sent the press: a privileged channel acts for a live
    // window it resolves, never for a window id from the payload.
    if (webContents && win.webContents !== webContents) continue;
    markInteracted(win);
    raiseBand(win);
  }
}

/**
 * The window the user touched last owns the top of the band. Windows are equal in the
 * topmost band, so a fixed raise order made Settings permanently outrank a palette the
 * user had just clicked (and vice versa). `raiseInteracted` raises this one window after
 * every other band window's *bit* has been repaired without moving it.
 */
function markInteracted(win) {
  if (win && !win.isDestroyed()) ctx.lastInteracted = win;
}

function raiseInteracted() {
  const win = ctx.lastInteracted;
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  raiseTopmost(win);
}

/**
 * Track interactions on a window we create: a focus (Settings, the popout) or a show
 * (a palette coming back, the overlay menu opening) counts as the user's last action.
 * The hooks live in `createWindows` (`browser-window-focus` / `browser-window-created`).
 */
function trackInteraction(win) {
  if (!win || win.isDestroyed()) return;
  win.on('focus', () => markInteracted(win));
  win.on('show', () => markInteracted(win));
}

/**
 * A text field needs real keyboard focus, which a WS_EX_NOACTIVATE window can never
 * take. Drop the native bit while the field is open (`on`) and restore it after, so
 * the palette is non-activating again as soon as editing ends.
 */
async function setPaletteEditable(on) {
  if (!ctx.popup || ctx.popup.isDestroyed()) return;
  // Toggling the band can deactivate the window; ignore that blur.
  ctx.focusGraceUntil = Date.now() + 900;
  forgetBand(ctx.popup);
  await ensureBand(ctx.popup, { noActivate: !on, topmost: true }).catch(() => {});
  if (on && ctx.popup && !ctx.popup.isDestroyed()) {
    try { ctx.popup.focus(); } catch { /* closing */ }
  }
}

// --- the summon hotkey -------------------------------------------------------
// A system-wide key that shows/hides the palette even while Clip Studio Paint has
// focus (docs/DEV.md). Only one is registered at a time; the accelerator is
// stored in `settings.summonHotkey` (empty = none).
let summonRegistered = '';

/** A non-F-key accelerator needs at least one modifier, or it would swallow typing. */
function validAccelerator(accel) {
  if (!accel) return true;
  const parts = String(accel).split('+').map((p) => p.trim()).filter(Boolean);
  const mods = parts.filter((p) => /^(Ctrl|Control|Alt|Shift|Super|Meta|CommandOrControl|CmdOrCtrl|Command|Cmd)$/i.test(p));
  const key = parts[parts.length - 1] || '';
  return mods.length > 0 || /^F([1-9]|1[0-9]|2[0-4])$/i.test(key);
}

/**
 * Register the palette's summon hotkey. Returns `{ ok, registered, accelerator,
 * error? }`; `ok:false` means the accelerator is invalid or already taken, so the
 * caller should not persist it.
 */
function applySummonHotkey(accel) {
  const next = String(accel || '').trim();
  if (summonRegistered === next) return { ok: true, registered: Boolean(next), accelerator: next };
  if (!validAccelerator(next)) return { ok: false, registered: false, accelerator: next, error: 'invalid' };
  if (summonRegistered) {
    try { globalShortcut.unregister(summonRegistered); } catch { /* keep going */ }
    summonRegistered = '';
  }
  if (!next) return { ok: true, registered: false, accelerator: '' };
  let ok = false;
  try { ok = globalShortcut.register(next, togglePopup); } catch { ok = false; }
  if (ok) summonRegistered = next;
  return ok
    ? { ok: true, registered: true, accelerator: next }
    : { ok: false, registered: false, accelerator: next, error: 'taken' };
}

/** Release the summon hotkey (on quit). */
function unregisterSummonHotkey() {
  if (!summonRegistered) return;
  try { globalShortcut.unregister(summonRegistered); } catch { /* keep going */ }
  summonRegistered = '';
}

// --- per-module command hotkeys ---------------------------------------------
// `settings.commandBindings` maps `"<instanceId>:<command>"` to an accelerator. Each is
// registered system-wide and, on press, calls the command through the command router
// (main owns it; ctx.commandRouter is set by ipc.js). A binding that is invalid or
// already taken is reported and left unregistered, never silently "remembered".
let commandHotkeys = new Map(); // accelerator -> binding key

/**
 * Replace every per-module hotkey. Returns `{ ok, registered, failures }` where
 * `failures` names the bindings that did not take, so the caller can refuse to
 * persist them.
 */
function applyCommandHotkeys(bindings) {
  for (const accel of commandHotkeys.keys()) {
    try { globalShortcut.unregister(accel); } catch { /* keep going */ }
  }
  commandHotkeys = new Map();
  const registered = {};
  const failures = [];
  for (const [key, accelRaw] of Object.entries(bindings || {})) {
    const accel = String(accelRaw || '').trim();
    const at = String(key).indexOf(':');
    const target = at === -1 ? '' : key.slice(0, at);
    const command = at === -1 ? '' : key.slice(at + 1);
    if (!accel || !target || !command) continue;
    if (!validAccelerator(accel)) { failures.push({ key, accel, error: 'invalid' }); continue; }
    let ok = false;
    try {
      ok = globalShortcut.register(accel, () => {
        try {
          const p = ctx.commandRouter && ctx.commandRouter.call({ target, command, args: [] });
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch { /* keep going */ }
      });
    } catch { ok = false; }
    if (ok) { commandHotkeys.set(accel, key); registered[key] = accel; }
    else failures.push({ key, accel, error: 'taken' });
  }
  return { ok: failures.length === 0, registered, failures };
}

/** Release every per-module hotkey (on quit). */
function unregisterCommandHotkeys() {
  for (const accel of commandHotkeys.keys()) {
    try { globalShortcut.unregister(accel); } catch { /* keep going */ }
  }
  commandHotkeys = new Map();
}

/** The stored UI scale, clamped to 0.8–1.6. */
function uiScaleValue() {
  const raw = Number(ctx.settings.get().uiScale);
  return Number.isFinite(raw) ? Math.max(0.8, Math.min(1.6, raw)) : 1;
}

/** Apply the UI scale to one window's web contents. */
function applyZoom(win) {
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(uiScaleValue());
}

/**
 * Apply the UI scale (0.8–1.6) to the palette and the Settings window. The
 * Settings window has no scrollbar — it sizes itself to its content — so zooming
 * only the web contents would hide the overflow. Keep its CSS layout width
 * constant by growing the window with the zoom.
 */
function applyUiScale() {
  const scale = uiScaleValue();
  applyZoom(ctx.popup);
  applyZoom(ctx.settingsWin);
  // A float keeps its CSS-pixel (layout.json) size; grow it with the zoom so
  // its content does not shrink.
  const doc = ctx.readLayoutDoc();
  for (const [floatId, win] of ctx.floatWins) {
    if (win.isDestroyed()) continue;
    applyZoom(win);
    // A collapsed float is showing only its bar; leave its (small) size alone.
    if (ctx.isFloatCollapsed && ctx.isFloatCollapsed(floatId)) continue;
    const f = doc && doc.floats.find((x) => x.floatId === floatId);
    const [rawW, rawH] = win.getContentSize();
    const cssW = f && Number.isFinite(f.width) ? f.width : rawW / scale;
    const cssH = f && Number.isFinite(f.height) ? f.height : rawH / scale;
    win.setContentSize(Math.round(cssW * scale), Math.round(cssH * scale));
  }
  if (ctx.moduleSettingsWin && !ctx.moduleSettingsWin.isDestroyed()) applyZoom(ctx.moduleSettingsWin);
  // Grow each window's physical size with the zoom, keeping its CSS layout size
  // constant (so content is not clipped and the layout does not reflow).
  if (ctx.popup && !ctx.popup.isDestroyed() && ctx.popupDesign) {
    ctx.popup.setContentSize(
      Math.round(ctx.popupDesign.width * scale),
      Math.round(ctx.popupDesign.height * scale),
    );
  }
  if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) {
    const cssW = Math.max(SETTINGS_WIDTH, ctx.settingsMinWidthCss || 0);
    if (ctx.settingsMinWidthCss) {
      const [, minH] = ctx.settingsWin.getMinimumSize();
      ctx.settingsWin.setMinimumSize(Math.round(cssW * scale), minH);
    }
    const [, h] = ctx.settingsWin.getContentSize();
    ctx.settingsWin.setContentSize(Math.round(cssW * scale), Math.max(1, Math.round(h)));
    raiseTopmost(ctx.settingsWin);
  }
  if (ctx.moduleSettingsWin && !ctx.moduleSettingsWin.isDestroyed()) raiseTopmost(ctx.moduleSettingsWin);
}

/** Keep the Settings window's OS background in step with the theme. */
function applyWindowTheme() {
  if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) {
    ctx.settingsWin.setBackgroundColor(ctx.themeBackground(ctx.settings.get().theme));
  }
}

// --- drag chip ---------------------------------------------------------------

// The module chip that follows the pointer while dragging. It lives in its own
// transparent, click-through window so it is not clipped by the window the drag
// started in (which is how a module can visibly cross to another window).


// The chip and the drop indicator share one transparent, click-through window
// covering the whole desktop, so the indicator is never clipped by a window or
// hidden behind another one (docs/LAYOUT.md, V4). It is only shown during a drag.
function overlayBox() {
  // Work areas, not display bounds: a desktop-sized surface is what Windows 11's
  // "full-screen app" automatic rule reads as Do Not Disturb. See overlay-bounds.js.
  return overlayBounds(screen.getAllDisplays());
}

function ensureOverlayWin() {
  if (ctx.overlayWin && !ctx.overlayWin.isDestroyed()) return ctx.overlayWin;
  const box = overlayBox();
  ctx.overlayBox = box;
  ctx.overlayWin = new BrowserWindow({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ctx.windowArgs || [],
      sandbox: false,
    },
  });
  ctx.overlayWin.setAlwaysOnTop(true, 'screen-saver');
  ctx.overlayWin.setIgnoreMouseEvents(true);
  ctx.overlayWin.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  ctx.overlayWin.webContents.on('did-finish-load', () => {
    if (!ctx.overlayWin || ctx.overlayWin.isDestroyed()) return;
    sendTo(ctx.overlayWin, 'overlay:update', ctx.overlayState);
    // A menu may have been asked for before this window had a renderer to draw it (the window is
    // created lazily on first use), so it is re-sent here — the same reason the chip state is.
    if (ctx.overlayMenu) sendTo(ctx.overlayWin, 'overlay:menu', { items: ctx.overlayMenu.items });
  });
  ctx.overlayWin.on('closed', () => { ctx.overlayWin = null; });
  return ctx.overlayWin;
}

/** Hide the drag chip (also used when a window disappears mid-drag). */
function hideOverlay() {
  if (ctx.overlayWin && !ctx.overlayWin.isDestroyed()) ctx.overlayWin.hide();
}

/** Show, move or hide the drag chip and the drop indicator. */
function showOverlay(sender, spec = {}) {
  if (spec.hide) {
    hideOverlay();
    return;
  }
  const win = ensureOverlayWin();
  // The surface covers the union of the displays' work areas (not a whole display:
  // that is what Windows 11 reads as full-screen and turns Do Not Disturb on), and it
  // must stay **still** for the whole drag: moving it mid-drag changes the origin every
  // position is measured against, which is what made the chip and the line jump between
  // "cut off" and "whole" in a loop (the user's report). So it is re-asserted
  // once, at the start of a drag (the first tick, when the window is not yet visible), and positions
  // are then clamped into it rather than the window being chased after the pointer.
  if (!win.isVisible()) {
    const wanted = overlayBox();
    const now = win.getBounds();
    if (now.x !== wanted.x || now.y !== wanted.y
      || now.width !== wanted.width || now.height !== wanted.height) {
      win.setBounds(wanted);
    }
  }
  let box = win.getBounds();
  const px = Number(spec.x) || 0;
  const py = Number(spec.y) || 0;
  ctx.overlayBox = box;
  const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));
  // The chip rides 10x12 px past the pointer (CSS px, as the renderer sends it);
  // the indicator line arrives in screen DIP. Both become overlay-local CSS px
  // here, which is the only conversion — the overlay itself never guesses.
  // The chip rides 10x12 px *up and to the left* of the pointer (CSS px, as the renderer
  // sends it), so it never sits under the cursor or over the drop point; `overlay.js`
  // pulls it the rest of the way with `translate(-100%, -100%)`.
  const zoom = (sender && sender.getZoomFactor && sender.getZoomFactor()) || 1;
  // Clamped into the surface: a position that would fall outside it is drawn at the edge, so the chip
  // and the line can never be sliced by the window's boundary.
  const chip = {
    x: clamp(Math.round(px * zoom - 10 - box.x), 0, box.width),
    y: clamp(Math.round(py * zoom - 12 - box.y), 0, box.height),
  };
  let line = null;
  if (spec.line && Number.isFinite(spec.line.x) && Number.isFinite(spec.line.y)) {
    const vertical = spec.line.axis === 'v';
    const rawLength = Number(spec.line.length) || 0;
    const x = clamp(Math.round(spec.line.x - box.x), 0, box.width);
    const y = clamp(Math.round(spec.line.y - box.y), 0, box.height);
    line = {
      x,
      y,
      length: clamp(rawLength, 0, vertical ? box.height - y : box.width - x),
      axis: vertical ? 'v' : 'h',
    };
  }
  // Snap zones (screen DIP) become overlay-local rects, the same conversion as the line.
  const zones = Array.isArray(spec.zones) ? spec.zones.map((z) => ({
    left: Math.round(z.x - box.x),
    top: Math.round(z.y - box.y),
    width: Math.max(1, Math.round(z.width)),
    height: Math.max(1, Math.round(z.height)),
    side: z.side,
  })) : [];
  // The dragged windows' outlines (screen DIP) become overlay-local rects, like the zones.
  const previews = Array.isArray(spec.previews) ? spec.previews.map((p) => ({
    left: Math.round(p.x - box.x),
    top: Math.round(p.y - box.y),
    width: Math.max(1, Math.round(p.width)),
    height: Math.max(1, Math.round(p.height)),
  })) : [];
  ctx.overlayState = { text: String(spec.text || ''), hint: Boolean(spec.hint), chip, line, zones, previews };
  sendTo(win, 'overlay:update', ctx.overlayState);
  if (!win.isVisible()) win.showInactive();
  else win.moveTop(); // keep it above the palette and every float
}

/**
 * Show the palette menu **outside** the palette window. A renderer cannot paint beyond its own window
 * and a palette is narrow, so an in-window menu can never cross its edge (the user's report). The
 * overlay window is already full-desktop and always-on-top; here its bounds are shrunk to the menu
 * itself, which is also what keeps clicks outside the menu reaching whatever is underneath — nothing
 * else is covered. `setIgnoreMouseEvents(false)` lasts only as long as the menu is open.
 */
function showOverlayMenu(sender, spec = {}) {
  // The profile list can be long. The window shows at most 10 rows and scrolls
  // the rest; the CSS completes the fix by refusing to shrink the rows.
  const items = Array.isArray(spec.items) ? spec.items.slice(0, 200) : [];
  if (!items.length) return;
  const anchor = spec.anchor || { x: 0, y: 0 };
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    closeOverlayMenu();
    return;
  }
  const win = ensureOverlayWin();
  const display = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) });
  const area = display.workArea;
  const box = menuBox({
    items,
    anchor,
    area,
    maxRows: Number.isFinite(spec.maxRows) ? spec.maxRows : 10,
    maxHeight: spec.maxHeight,
    width: spec.width,
  });
  win.setBounds(box);
  ctx.overlayBox = win.getBounds();
  // `menu` tells the pick handler which window asked; `palette` is the default so the
  // old palette menu keeps working unchanged.
  ctx.overlayMenu = { items, menu: spec.menu || 'palette', senderId: sender ? sender.id : null };
  win.setIgnoreMouseEvents(false);
  sendTo(win, 'overlay:menu', { items });
  // Above the palette: on Windows every always-on-top window is the same level, so
  // the only reliable order is raise-after-show. Without it a palette that was
  // raised (a click, a drag) could sit over the menu (the user's report).
  win.setAlwaysOnTop(true, 'screen-saver');
  if (!win.isVisible()) win.showInactive();
  win.moveTop();
}

/** Close the palette menu and give the overlay back its click-through behaviour. */
function closeOverlayMenu() {
  ctx.overlayMenu = null;
  const win = ctx.overlayWin;
  if (!win || win.isDestroyed()) return;
  sendTo(win, 'overlay:menu', null);
  win.setIgnoreMouseEvents(true);
  win.hide();
}

/** Take a module id out of every float (used when a module is disabled). */
function removeModuleFromFloats(moduleId) {
  if (!moduleId) return;
  const doc = ctx.readLayoutDoc();
  if (!doc) return;
  const emptied = [];
  let changed = false;
  for (const f of doc.floats) {
    const before = JSON.stringify(f.columns || []);
    f.columns = (f.columns || []).map((col) => ({
      ...col,
      modules: (col.modules || []).filter((m) => m.moduleId !== moduleId),
    })).filter((col) => col.modules.length > 0);
    if (JSON.stringify(f.columns) === before) continue;
    changed = true;
    if (!f.columns.length) emptied.push(f.floatId);
  }
  if (!changed) return;
  doc.floats = doc.floats.filter((f) => (f.columns || []).length > 0);
  ctx.writeLayoutDoc(doc);
  for (const id of emptied) ctx.closeFloatWin(id);
}

// --- module ctx.settings popout --------------------------------------------------


function closeModuleSettingsWindow() {
  if (ctx.moduleSettingsWin && !ctx.moduleSettingsWin.isDestroyed()) ctx.moduleSettingsWin.close();
  ctx.moduleSettingsWin = null;
}

/**
 * A module's ctx.settings in their own always-on-top window, so they are not
 * limited by the palette's size. It closes when it loses focus.
 */
function openModuleSettingsWindow(spec = {}) {
  const { moduleId, instanceId, anchor } = spec;
  if (!moduleId) return false;
  closeModuleSettingsWindow();

  const width = 236;
  const height = 220;
  const hasAnchor = anchor
    && Number.isFinite(anchor.left) && Number.isFinite(anchor.right) && Number.isFinite(anchor.top);
  const cursor = screen.getCursorScreenPoint();
  const area = hasAnchor
    ? screen.getDisplayMatching({ x: anchor.right, y: anchor.top, width: 1, height: 1 }).workArea
    : screen.getDisplayNearestPoint(cursor).workArea;
  const palette = ctx.popup && !ctx.popup.isDestroyed() ? ctx.popup.getBounds() : null;

  let px;
  if (hasAnchor) {
    px = anchor.right + 6; // prefer the module's right
    if (px + width > area.x + area.width - 4) px = anchor.left - width - 6; // else its left
  } else {
    px = palette ? palette.x + palette.width + 6 : area.x + 120;
  }
  let py = hasAnchor ? anchor.top : (palette ? palette.y + 40 : area.y + 120);
  // Keep the popout on screen.
  px = Math.max(area.x + 4, Math.min(Math.round(px), area.x + area.width - width - 4));
  py = Math.max(area.y + 4, Math.min(Math.round(py), area.y + area.height - height));

  ctx.moduleSettingsWin = new BrowserWindow({
    width,
    height: 200,
    x: px,
    y: py,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ctx.windowArgs || [],
      sandbox: false,
    },
  });
  // Hold this window locally: a replaced popout's late 'closed' must not clear the
  // new window's reference (openModuleSettingsWindow closes the old one first).
  const win = ctx.moduleSettingsWin;
  win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, '..', 'renderer', 'module-settings.html'), {
    query: { moduleId, instanceId },
  });
  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) {
      applyZoom(win);
      win.show();
      // The runtime's always-on-top request is dropped on this build, so the popout
      // would open under the palette: assert the band now, and again on every resize.
      raiseTopmost(win);
      win.focus();
    }
  });
  if (ctx.isDev || ctx.shotPath || process.argv.includes('--log')) {
    win.webContents.on('console-message', (_e, _l, message) => {
      console.log('[module-settings]', message ?? (_e && _e.message));
    });
  }
  // Close when the user really clicks away, but not on the transient blur a palette
  // band repair can cause: an instant close made the popup look like it never opened.
  let blurTimer = null;
  win.on('blur', () => {
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      blurTimer = null;
      if (ctx.moduleSettingsWin === win) closeModuleSettingsWindow();
    }, 150);
  });
  win.on('focus', () => {
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
  });
  win.on('closed', () => { if (ctx.moduleSettingsWin === win) ctx.moduleSettingsWin = null; });
  return true;
}

// --- auto connect ------------------------------------------------------------


// While the palette is parked off the QR, its moves (and the trailing move
// events) must not overwrite the remembered window position or drag floats.

const AUTO_CONNECT_STATES = new Set(['idle', 'error']);
function canAutoConnect() {
  if (!ctx.settings || !ctx.service) return false;
  // Quitting: a scan started during shutdown would outlive the windows.
  if (ctx.quoted) return false;
  // The boot saved-connection attempt owns the service until `start()` returns.
  if (!ctx.autoConnectArmed) return false;
  if (ctx.settings.get().autoConnect === false) return false;
  if (Date.now() < ctx.autoConnectResumeAt) return false;
  // A client that is retrying itself owns the socket. Scanning now would tear it down
  // and turn a 250 ms retry into a 30 s scan (the "reconnect is not instant" bug).
  if (ctx.service.retrying && ctx.service.retrying()) return false;
  return AUTO_CONNECT_STATES.has(ctx.service.snapshot().status.state);
}

/** While disconnected and auto-connect is on, look for the QR code again. */
function scheduleAutoConnect({ immediate = false } = {}) {
  if (ctx.autoConnectTimer) {
    clearTimeout(ctx.autoConnectTimer);
    ctx.autoConnectTimer = null;
  }
  if (!canAutoConnect()) return;
  ctx.autoConnectTimer = setTimeout(async () => {
    ctx.autoConnectTimer = null;
    if (!canAutoConnect()) return;
    // Scan quickly so a QR that appears while disconnected is caught within about
    // a second: the old 2.5s first delay plus a 1.5s poll was the slow part.
    // `intervalMs` is a floor between captures, not the whole gap. Each pass now
    // captures the Companion dialog itself (fast and reliable), so the interval
    // can be short.
    try {
      // First with the palette left where it is; if that finds nothing it is
      // probably covering the QR, so park it aside and keep scanning.
      await ctx.service.pair({ intervalMs: 150, timeoutMs: 5000 });
      if (ctx.service.snapshot().status.state !== 'connected') {
        await withPopupParked(() => ctx.service.pair({ intervalMs: 150, timeoutMs: 25000 }));
      }
    } catch { /* surfaced through status */ }
    scheduleAutoConnect();
  }, immediate ? 0 : 100);
  ctx.autoConnectTimer.unref?.();
}

// --- focus following --------------------------------------------------------

const isCspProcess = (name) => /clipstudiopaint|clipstudio/i.test(name);
function isOwnProcess(name) {
  const lower = name.toLowerCase();
  const own = path.basename(process.execPath, '.exe').toLowerCase();
  return lower === own || lower === 'electron';
}

function focusState(name) {
  return focusAction({
    autoHide: ctx.settings.get().autoHide !== false,
    isCsp: isCspProcess(name),
    isOwn: isOwnProcess(name),
    grace: Date.now() < ctx.focusGraceUntil,
  });
}

function startFollowFocus() {
  if (ctx.fgWatcher) return;
  ctx.fgWatcher = new ForegroundWatcher();
  ctx.fgWatcher.on('change', (name) => {
    if (!name) return;
    ctx.fgHealthy = true;
    ctx.fgName = name;
    if (isCspProcess(name)) ctx.lastCspAt = Date.now();
    if (!ctx.popup) return;
    const action = focusState(name);
    traceFocus('change', JSON.stringify({ name, action }));
    if (action === 'show') {
      if (!ctx.popup.isVisible()) showPopupAuto();
      // Coming back to CSP is the moment a saved reconnect is most likely to work and a
      // scan most likely to find the QR; don't wait for the next timer tick.
      if (typeof scheduleAutoConnect === 'function') scheduleAutoConnect({ immediate: true });
    } else if (action === 'hide') {
      // The foreground event is authoritative: hide now, with no debounce or
      // PowerShell re-query. A stale poll could only add latency.
      hidePopup();
    }
  });
  ctx.fgWatcher.on('down', () => {
    // The watcher is not authoritative while it is down: keep, never guess.
    ctx.fgHealthy = false;
    traceFocus('watcher down -> keep');
  });
  // Safety net. `foreground.ps1` is event-driven, and a missed event (a lock screen,
  // a runtime hiccup) leaves the palette hidden while CSP is focused — the "does not
  // reappear" report. While Auto-hide is on and the palette is hidden, re-query the
  // foreground on a slow timer and show it if CSP really is in front.
  if (ctx.fgSafety) clearInterval(ctx.fgSafety);
  ctx.fgSafety = setInterval(async () => {
    if (!ctx.popup || ctx.popup.isDestroyed() || ctx.popup.isVisible()) return;
    if (ctx.settings.get().autoHide === false) return;
    let name = '';
    try { name = await ctx.fgWatcher.refresh(); } catch { name = ''; }
    if (!name || !isCspProcess(name)) return;
    ctx.fgHealthy = true;
    ctx.fgName = name;
    ctx.lastCspAt = Date.now();
    traceFocus('safety -> show');
    showPopupAuto();
  }, 5000);
  if (ctx.fgSafety.unref) ctx.fgSafety.unref();
  ctx.fgHealthy = false;
  ctx.fgWatcher.start();
}

function stopFollowFocus() {
  if (ctx.fgWatcher) {
    ctx.fgWatcher.stop();
    ctx.fgWatcher = null;
  }
  if (ctx.fgSafety) {
    clearInterval(ctx.fgSafety);
    ctx.fgSafety = null;
  }
  ctx.fgHealthy = false;
  ctx.fgName = '';
}

/**
 * Start/stop foreground following when the Auto-hide setting changes at runtime.
 * At boot the watcher is started by main; without this, turning Auto-hide on in
 * Settings left `fgHealthy` false and the old blur fallback hid the palette.
 */
function applyAutoHide(enabled) {
  const on = enabled !== false;
  // The watcher also supplies the foreground process used by the Companion
  // worktime gate, so it keeps running when Auto-hide is off; `focusState`
  // returns `keep` for every change in that mode.
  if (!ctx.fgWatcher) startFollowFocus();
  traceFocus(on ? 'auto-hide enabled' : 'auto-hide disabled');
}

/** Park the ctx.popup at the right edge so it does not cover CSP's centered QR. */
function positionPopupForScan() {
  if (!ctx.popup) return;
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const [w, h] = ctx.popup.getSize();
  ctx.popup.setPosition(
    Math.round(workArea.x + workArea.width - w - 16),
    Math.round(workArea.y + (workArea.height - h) / 2),
    false,
  );
}

/**
 * Move the palette off the QR for the duration of `fn`, then put it back. The
 * temporary position is never remembered: the move and resize handlers are muted
 * while parked, so the palette cannot "teleport" to the scan spot on the next
 * launch.
 *
 * It is re-entrant: auto-connect can park for a long scan and a manual Connect
 * (or another tick) can arrive inside it. Only the outermost call parks and
 * restores, so an inner call never captures the parked position as the place to
 * return to.
 */
async function withPopupParked(fn) {
  if (!ctx.popup || ctx.popup.isDestroyed() || !ctx.popup.isVisible()) return fn();
  if (ctx.parkDepth === 0) {
    ctx.parkOrigin = ctx.popup.getPosition();
    positionPopupForScan();
  }
  ctx.parkDepth += 1;
  ctx.popupParked = true;
  try {
    return await fn();
  } finally {
    ctx.parkDepth -= 1;
    if (ctx.parkDepth === 0) {
      if (ctx.popup && !ctx.popup.isDestroyed()) ctx.popup.setPosition(ctx.parkOrigin[0], ctx.parkOrigin[1], false);
      ctx.popupParked = false;
      // Move events can arrive a tick late; keep muting briefly so the restored
      // position is what gets saved.
      ctx.parkReleaseAt = Date.now() + 600;
    }
  }
}

async function startPairing() {
  // A manual scan supersedes any scheduled auto-connect tick; the service's own
  // `scanning` guard prevents a second loop from starting.
  if (ctx.autoConnectTimer) {
    clearTimeout(ctx.autoConnectTimer);
    ctx.autoConnectTimer = null;
  }
  await withPopupParked(() => ctx.service.pair());
}

// --- ctx.tray -------------------------------------------------------------------

/** Draw the tray icon from the same pastel big-I art as the app icon (BGRA). */
function makeTrayIcon() {
  const size = 32;
  const buf = rgbaToBgra(drawIcon(size));
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function buildTray() {
  ctx.tray = new Tray(makeTrayIcon().resize({ width: 16, height: 16 }));
  ctx.tray.setToolTip('Iroiroppa');
  ctx.tray.setContextMenu(Menu.buildFromTemplate(trayMenu()));
  ctx.tray.on('click', togglePopup);
}

/** The tray menu template, translated. */
function trayMenu() {
  const t = ctx.t || ((key) => key);
  return [
    { label: t('tray.showHide'), click: togglePopup },
    { label: t('tray.bringFloats'), click: () => { showPopup(); if (ctx.reclampFloats) ctx.reclampFloats(); } },
    { type: 'separator' },
    // Settings lives here and in the palette's `session` module — never only in the window that
    // happens to be first (docs/LAYOUT.md, "One palette").
    { label: t('tray.settings'), click: () => ctx.createSettingsWindow() },
    { type: 'separator' },
    { label: t('tray.reconnect'), click: () => ctx.service.connectSaved().catch(() => {}) },
    { label: t('tray.connectScan'), click: () => { showPopup(); startPairing().catch(() => {}); } },
    { label: t('tray.disconnect'), click: () => ctx.service.disconnect().catch(() => {}) },
    { label: t('tray.forget'), click: () => ctx.service.disconnect({ forget: true }).catch(() => {}) },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => { ctx.quoted = true; app.quit(); } },
  ];
}

/** Rebuild the tray menu in place (a language change). */
function refreshTray() {
  if (ctx.tray && !ctx.tray.isDestroyed()) ctx.tray.setContextMenu(Menu.buildFromTemplate(trayMenu()));
}

  return {
    isCspForeground: () => Boolean(ctx.fgHealthy) && isCspProcess(ctx.fgName),    createPopup, createSettingsWindow, showPopup, showPopupAuto, hidePopup, positionPopup, togglePopup, resetInputState, reassertBand, reassertTopmost: raiseTopmost, setPaletteEditable, applySummonHotkey, unregisterSummonHotkey, applyCommandHotkeys, unregisterCommandHotkeys, uiScaleValue, applyZoom, applyUiScale, applyWindowTheme, ensureOverlayWin, hideOverlay, showOverlay, showOverlayMenu, closeOverlayMenu, showTooltip, hideTooltip, removeModuleFromFloats, closeModuleSettingsWindow, openModuleSettingsWindow, AUTO_CONNECT_STATES, canAutoConnect, scheduleAutoConnect, startPairing, isCspProcess, isOwnProcess, startFollowFocus, stopFollowFocus, applyAutoHide, positionPopupForScan, makeTrayIcon, buildTray, refreshTray,
  };
}

module.exports = { createWindows };

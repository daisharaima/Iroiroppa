'use strict';

/* OKLCH picker renderer: the kernel / chrome.
 *
 * Colour state lives in a ColorStore; the picker body is built from selector
 * modules (src/renderer/selector_module), mounted by the ModuleHost. This file
 * owns the board and the palette's own state. The connection chrome (dot, banner), the mode bar
 * and the footer (swatch, hex, tools) used to live here; they are the `session` and `color-stat`
 * modules now, so they exist in every palette (docs/LAYOUT.md, "One palette"). */

(function () {
  const Color = window.Color;
  const Proof = window.Proof;
  const $ = (id) => document.getElementById(id);
  const csp = window.csp;
  // The window's own state only; the chrome it used to draw is the `session` / `color-stat`
// modules now (docs/LAYOUT.md, "One palette").

  window.addEventListener('error', (e) => {
    window.__renderError = String((e.error && e.error.stack) || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    window.__renderError = String((e.reason && e.reason.stack) || e.reason);
  });

  // --- elements --------------------------------------------------------------

  // Only the palette's own controls are left: the chrome that used to be here is the `session`
  // and `color-stat` modules now (docs/LAYOUT.md, "One palette").
  const el = {
    btnCollapse: $('btn-collapse'),
  };

  // --- state -----------------------------------------------------------------

  const capabilities = window.Iro.createCapabilityStore();
  capabilities.refresh();

  const store = new window.Iro.ColorStore({ csp });
  window.__store = store; // used by the --transparent dev flag
  const themeRegistry = new window.Iro.ThemeRegistry();

  const chrome = {
    settings: {},
    scanning: false,
    profiles: [],
  };

  const MODES = ['default', 'proof'];

  // --- board -----------------------------------------------------------------

  const boardEl = $('board');
  const host = new window.Iro.ModuleHost({ root: boardEl, color: store, csp, capabilities });
  // Both come from the shared manifest (src/shared/module-manifest.js): the ids
  // the renderer mounts, and the modules of the first-run board.
  // User modules (docs/USER-MODULES.md) must be known before the board is built.
  try { window.IroModuleManifest.register(window.csp.userModules()); } catch { /* bundled only */ }
  const MODULE_IDS = window.IroModuleManifest.ids();
  // Used on first run, before any layout.json exists.
  const DEFAULT_LAYOUT = {
    version: 1,
    floats: [],
    columns: [{
      id: 'c1',
      width: null,
      modules: window.IroModuleManifest.defaultIds().map((moduleId, i) => {
        // Carry the locked ratio from the manifest so the very first paint is already
        // the right shape (the stored document replaces this a moment later).
        const def = window.IroModuleManifest.get(moduleId);
        return {
          instanceId: `i${i + 1}`,
          moduleId,
          weight: null,
          ratio: def && Number.isFinite(def.defaultRatio) && def.defaultRatio > 0 ? def.defaultRatio : null,
        };
      }),
    }],
  };
  // In `model` mode the layout arrives through the state adapter, so the board must
  // not also subscribe to the legacy channel (docs/STATE.md, §12.2).
  const modelMode = Boolean(window.Iro.state && window.Iro.state.mode === 'model');
  const board = new window.Iro.Board({
    root: boardEl, host, csp, defaultLayout: DEFAULT_LAYOUT, subscribe: !modelMode,
    // The window's own palette columns (plan: palette equality, P4) — main resolves the
    // palette from the sender, so there is no "primary" and no float split here. The IPC
    // already answers with a v1 `{version, columns}` (or null on a first run, so the board
    // uses its own default), so it is passed straight through.
    load: () => csp.getPaletteColumns(),
    save: (layout) => csp.setPaletteColumns(layout.columns),
  });
  window.__board = board; // used by the --board-size dev flag
  // A theme that changes a structural token (see kernel/themes.js) resizes the
  // cards, so re-clamp this window once.
  window.addEventListener('theme-structural', () => board.remeasure());

  // --- the board's own state --------------------------------------------------

  /** The palette window's own chrome is gone: the colour's numbers are the `color-stat` module,
   *  the connection and the profile are the `session` module, and both live in *every* palette
   *  (docs/LAYOUT.md, "One palette"). What is left here is the board's own state. */
  function renderChrome() {
    boardEl.dataset.transparent = store.transparent ? 'true' : 'false';
  }

  // --- proof modes -----------------------------------------------------------

  async function loadProof() {
    try {
      const info = await csp.getProof();
      store.proofInfo = info;
      const model = (chrome.settings && chrome.settings.proofModel) || 'working';
      store.proof = info && info.ok ? Proof.createProof(info.profile, model) : null;
    } catch (err) {
      store.proof = null;
      store.proofInfo = { ok: false, error: err.message };
    }
    store.notify();
  }

  // The colour-profile *picker* moved to the `session` module (docs/LAYOUT.md, "One palette"), so
  // the palette window keeps only the proof *data*: `loadProof` above and `refreshProfile` below.

  /** Re-read the proof profile and re-interpret the stored colour (nothing is
   * written to CSP — the stored value has not changed, only how we read it). */
  async function refreshProfile() {
    await loadProof();
    store.reinterpret();
  }

  // The mode buttons lived in the palette's own footer, which is gone (the profile switcher is
  // the `session` module now), so there is nothing left to reflect here.
  //
  // The proof-mode toggle, the pinned "default" entry and the profile chooser were this window's
  // controls too. They are the `session` module's now (docs/LAYOUT.md, "One palette"), which
  // applies the same rule when a profile is chosen: choosing one turns proofing on.

  async function setMode(mode) {
    if (!MODES.includes(mode)) return;
    store.mode = mode;
    csp.updateSettings({ proofMode: mode });
    if (mode !== 'default' && !store.proof) await loadProof();
    // Re-interpret the current stored colour under the new mode.
    store.reinterpret();
  }

  // --- settings + status -----------------------------------------------------

  function applySettings(s) {
    const prev = chrome.settings || {};
    chrome.settings = { ...s };
    // Language: the stored choice, else the system's.
    const lang = s.language || navigator.language || 'en';
    if (lang !== window.Iro.i18n.code) window.Iro.i18n.use(lang);
    store.liveSync = s.liveSync !== false;
    store.setViewFamily(s.viewFamily);
    store.historyGate = s.historyGate === true;
    store.markOutOfDisplay = s.markOutOfDisplay === true;
    themeRegistry.apply(s.theme, s.accents || {});
    const locked = s.locked === true;
    board.setLocked(locked);
    document.body.classList.toggle('locked', locked);
    if (el.btnLock) {
      el.btnLock.classList.toggle('active', locked);
      el.btnLock.title = locked ? 'Unlock the layout' : 'Lock the layout';
    }
    boardEl.dataset.names = s.hideModuleNames === true ? 'hidden' : '';

    const model = s.proofModel || 'working';
    const profileChanged = (s.proofProfile || '') !== (prev.proofProfile || '');
    if (profileChanged) {
      // A profile chosen in the Settings window: re-read it and re-interpret the
      // stored colour (never re-send it).
      refreshProfile();
    } else if (model !== prev.proofModel && store.proofInfo && store.proofInfo.ok) {
      store.proof = Proof.createProof(store.proofInfo.profile, model);
      store.notify();
    }

    // Keep the mode in step with settings changes (e.g. the --mode dev flag).
    const wantMode = s.proofMode === 'default' ? 'default' : 'proof';
    if (wantMode !== store.mode) setMode(wantMode);
  }

  function updateStatus(status) {
    const wasConnected = store.connected;
    store.connected = status.state === 'connected';
    chrome.scanning = status.state === 'scanning';

    // The dot and the connection banner lived in this window's own chrome; the connection state
    // and its light are the `session` module now, in every palette (docs/LAYOUT.md, "One
    // palette"), so this handler only keeps the app's own state in step.

    // A pick made while we were disconnected: push it now.
    if (!wasConnected && store.connected && store.pendingSend) store.flushPending();
  }

  // --- wiring ----------------------------------------------------------------

  /** The title bar moves the window by hand, so a click on it still reaches the
   * page (an app-region drag would swallow it, and a click should close any
   * open popout). */
  function attachTitlebarDrag() {
    const bar = $('titlebar');
    if (!bar) return;
    // The window move is our own drag session, not an OS window drag (docs/LAYOUT.md, "Snap
    // zones"): the palette *hides* while it moves so only its name chip is seen, and main
    // moves the whole snap group. The pointer is captured so the drag survives the cursor
    // leaving the window.
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // The locked layout does not move: dragging is off (docs/LAYOUT.md).
      if (board && board.locked) return;
      // The eye (collapse) button, the gear and the name field are not drag areas —
      // a pointerdown here must reach the button, or the click never fires.
      if (e.target.closest('.title-actions, #btn-unsnap, #btn-collapse, #btn-settings, #palette-name, #palette-menu')) return;
      try { bar.setPointerCapture(e.pointerId); } catch { /* in-window only */ }
      const name = $('palette-name');
      csp.dragBegin({ kind: 'palette', text: (name && name.value) || '' });
    });
    // A release anywhere in the window ends the drag, not just one on the titlebar: the session
    // lives in main, and a lost release leaves the chip on screen and the palette invisible.
    window.addEventListener('pointerup', () => csp.dragDrop());
    window.addEventListener('pointercancel', () => csp.dragCancel());
  }

  /** Bottom-right grip that resizes the frameless window via IPC. */
  function attachResizeGrip() {
    const grip = $('resize-grip');
    if (!grip) return;
    let start = null;
    grip.addEventListener('pointerdown', (e) => {
      if (document.body.classList.contains('locked')) return;
      start = { x: e.screenX, y: e.screenY, w: window.innerWidth, h: window.innerHeight };
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    window.addEventListener('pointermove', (e) => {
      if (!start) return;
      // Never shrink below what every module needs to stay fully visible.
      const min = board.minWindowSize();
      const w = Math.max(min.width, start.w + (e.screenX - start.x));
      const h = Math.max(min.height, start.h + (e.screenY - start.y));
      csp.resize(w, h);
    });
    const stop = () => { start = null; };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  function wire() {
    attachResizeGrip();
    if (window.Iro.wireEditableFields) window.Iro.wireEditableFields(csp);
    attachTitlebarDrag();
    board.bindPaletteName($('palette-name'));
    board.bindUnsnap($('btn-unsnap'));
    board.bindPaletteMenu({ button: $('btn-menu'), menu: $('palette-menu'), nameInput: $('palette-name') });
    // A collapsed palette reopens collapsed. One extra ask rather than a push:
    // a push can arrive before the board exists (same reason `palette:state:get` exists).
    if (csp.paletteState) {
      csp.paletteState()
        .then((state) => {
          if (state && state.collapsed) applyCollapsed(true);
        })
        .catch(() => { /* leave it expanded */ });
    }

    // The mode buttons, the profile popup and the hex/paste/cross controls all lived in this
    // window's own chrome, which is gone: the profile switcher is the `session` module, the HEX
    // and the crosshair are `color-stat` and a Settings row (docs/LAYOUT.md, "One palette").
    // What remains is the palette's own collapse.
    // Collapse the palette to just its title bar, or expand it again. A function
    // declaration so the boot-time restore below can call it regardless of order.
    let expandedHeight = 0;
    function applyCollapsed(collapsed) {
      document.body.classList.toggle('collapsed', collapsed);
      el.btnCollapse.title = collapsed ? 'Expand' : 'Collapse';
      el.btnCollapse.setAttribute('aria-label', el.btnCollapse.title);
      $('icon-eye-open').classList.toggle('hidden', collapsed);
      $('icon-eye-closed').classList.toggle('hidden', !collapsed);
      if (collapsed) {
        expandedHeight = window.innerHeight;
        csp.setCollapsed(true, $('titlebar').offsetHeight);
      } else {
        csp.setCollapsed(false, Math.max(expandedHeight, board.minWindowSize().height));
      }
    }
    el.btnCollapse.addEventListener('click', () => applyCollapsed(!document.body.classList.contains('collapsed')));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') csp.hide();
    });

    // Safety net: a drag can be interrupted by the window hiding (follow-focus),
    // which would otherwise leave `dragging` stuck and block incoming colours.
    window.addEventListener('pointerup', () => { store.dragging = false; });
    window.addEventListener('blur', () => { store.dragging = false; window.dispatchEvent(new Event('iro:input-reset')); });
    // Clicking the palette counts as "outside" the module settings popout.
    document.addEventListener('pointerdown', () => csp.closeModuleSettings(), true);
    if (csp.onInputReset) {
      csp.onInputReset(() => {
        if (document.exitPointerLock) document.exitPointerLock();
        window.dispatchEvent(new Event('iro:input-reset'));
      });
    }
    // `--trace-input`: log what this page receives, so a dead-looking palette can
    // say whether the press ever reached the DOM (docs/DEV.md).
    if (window.IroInputReset && window.IroInputReset.trace) window.IroInputReset.trace(csp);
    // Every press re-asserts the native window band: Chromium drops the topmost bit
    // when it rewrites the style on the activation attempt (topmost.js).
    window.addEventListener('pointerdown', () => { if (csp.inputPress) csp.inputPress(); }, true);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') window.dispatchEvent(new Event('iro:input-reset'));
    }, true);

    store.subscribe(renderChrome);
    if (window.Iro.state && window.Iro.state.mode === 'model') {
      // The canonical model is the source; each domain has a pure adapter
      // (docs/STATE.md, §12.2). No window hand-mirrors a channel.
      window.Iro.stateAdapters.capabilities(capabilities);
      window.Iro.stateAdapters.connection(updateStatus);
      window.Iro.stateAdapters.color((color) => store.applyIncoming(color));
      window.Iro.stateAdapters.history(store);
      window.Iro.stateAdapters.layout((layout) => board.applyLayout(layout));
      window.Iro.stateAdapters.health((v) => { window.Iro.health = v; });
    } else {
      csp.onStatus(updateStatus);
      csp.onColor((color) => store.applyIncoming(color));
      // The history is shared with any float window (main owns the list).
      if (csp.onHistoryChanged) csp.onHistoryChanged((list) => store.setHistory(list));
    }
    if (csp.onColorPreview) csp.onColorPreview((color) => store.applyPreview(color));
    csp.onSettings(applySettings);
  }

  async function init() {
    wire();
    await themeRegistry.load();

    // Load the catalog before the modules mount: `applySettings` runs after the
    // board, so a dynamic label rendered on mount (History's empty state, CSP
    // Shortcuts) would otherwise print its raw key.
    let snap = null;
    try {
      snap = await csp.snapshot();
      const lang = (snap.settings && snap.settings.language) || navigator.language || 'en';
      await window.Iro.i18n.use(lang);
    } catch { /* English fallback */ }

    try {
      await host.load(MODULE_IDS);
      await board.init();
      if (window.Iro.wireEditableFields) window.Iro.wireEditableFields(csp);
    } catch (err) {
      console.error('[kernel] could not load selector modules', err);
    }

    snap = snap || await csp.snapshot();
    applySettings(snap.settings);
    await loadProof();
    if (snap.settings.proofMode && snap.settings.proofMode !== 'default') {
      // Migrate the old third mode to the two-button bar.
      const mode = snap.settings.proofMode === 'softproof' ? 'proof' : snap.settings.proofMode;
      await setMode(mode);
    }
    updateStatus(snap.status);
    if (snap.color) store.applyIncoming(snap.color);
    try { store.setHistory(await csp.getHistory()); } catch { /* start empty */ }
    store.notify();
  }

  init();
})();

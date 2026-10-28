'use strict';

// A floated board window: a small board of its own (columns of modules) with
// its own ColorStore, kept in step with the palette through the main process's
// colour/settings broadcasts. Modules can be dragged between it and the palette
// (or another float) exactly as they are within the palette.

(function () {
  const Proof = window.Proof;
  const csp = window.csp;

  window.addEventListener('error', (e) => {
    window.__renderError = String((e.error && e.error.stack) || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    window.__renderError = String((e.reason && e.reason.stack) || e.reason);
  });

  const params = new URLSearchParams(location.search);
  const floatId = params.get('floatId') || '';

  const boardEl = document.getElementById('board');
  const store = new window.Iro.ColorStore({ csp });
  window.__store = store; // used by the --shot diagnostics
  const themeRegistry = new window.Iro.ThemeRegistry();
  const host = new window.Iro.ModuleHost({ root: boardEl, color: store, csp });

  let settings = {};

  async function loadProof() {
    try {
      const info = await csp.getProof();
      store.proofInfo = info;
      const model = settings.proofModel || 'working';
      store.proof = info && info.ok ? Proof.createProof(info.profile, model) : null;
    } catch (err) {
      store.proof = null;
      store.proofInfo = { ok: false, error: err.message };
    }
  }

  function modeOf(s) {
    return s.proofMode === 'default' ? 'default' : 'proof';
  }

  /**
   * Track the CSP connection. A float has its own ColorStore, and without this
   * it never marks itself connected, so `_write` only queues and a pick made in
   * a floated module is never sent to CSP (CSP Color still works because it
   * calls `selectSlot` directly).
   */
  function onStatus(status) {
    const wasConnected = store.connected;
    store.connected = Boolean(status && status.state === 'connected');
    if (!wasConnected && store.connected && store.pendingSend) store.flushPending();
  }

  /** Every window honours "Hide module names", not just the palette: the board carries the
   *  CSS hook (`#board[data-names="hidden"] .module-title`), and a float is a palette too. */
  function applyNameSetting(s) {
    const boardEl = document.getElementById('board');
    if (boardEl) boardEl.dataset.names = s.hideModuleNames === true ? 'hidden' : '';
  }

  async function applySettings(s) {
    const prev = settings;
    settings = { ...s };
    applyNameSetting(s);
    // The float follows the palette's language; only switch when it changed, or every
    // settings push would rewrite the whole DOM's strings.
    const language = s.language || navigator.language || 'en';
    if (language !== appliedLanguage) {
      appliedLanguage = language;
      window.Iro.i18n.use(language);
    }
    store.liveSync = s.liveSync !== false;
  store.setViewFamily(s.viewFamily);
  store.historyGate = s.historyGate === true;
  store.markOutOfDisplay = s.markOutOfDisplay === true;
    store.mode = modeOf(s);
    themeRegistry.apply(s.theme, s.accents || {});
    const proofChanged = (s.proofProfile || '') !== (prev.proofProfile || '')
      || (s.proofModel || '') !== (prev.proofModel || '');
    if (proofChanged) {
      await loadProof();
      store.reinterpret();
    } else {
      store.notify();
    }
  }

  let appliedLanguage = null;

  async function init() {
    // User modules (docs/USER-MODULES.md) must be known before the board loads them.
    try { window.IroModuleManifest.register(csp.userModules()); } catch { /* bundled only */ }
    await themeRegistry.load();
    const snapshot = await csp.snapshot();
  settings = { ...(snapshot.settings || {}) };
  // The window follows the palette's language.
  appliedLanguage = settings.language || navigator.language || 'en';
  try { await window.Iro.i18n.use(appliedLanguage); } catch { /* English fallback */ }
    applyNameSetting(settings);
    store.liveSync = settings.liveSync !== false;
  store.setViewFamily(settings.viewFamily);
  store.historyGate = settings.historyGate === true;
  store.markOutOfDisplay = settings.markOutOfDisplay === true;
    store.mode = modeOf(settings);
    store.connected = Boolean(snapshot.status && snapshot.status.state === 'connected');
    themeRegistry.apply(settings.theme, settings.accents || {});

    // Build the board (and register its cross-window listeners) before the slow
    // proof load: main can drop a module onto a float as soon as its window
    // exists, and a listener registered after that would miss it.
    const modelMode = Boolean(window.Iro.state && window.Iro.state.mode === 'model');
    const board = new window.Iro.Board({
      root: boardEl,
      host,
      csp,
      float: true,
      floatId,
      subscribe: !modelMode,
      load: () => csp.getPaletteColumns(),
      save: (layout) => csp.setPaletteColumns(layout.columns),
      resize: (width, height) => csp.resizeSelf(width, height),
    });
    window.__board = board; // used by the --shot flags and diagnostics
    // A theme that changes a structural token resizes the cards; re-clamp once.
    window.addEventListener('theme-structural', () => board.remeasure());
    board.setLocked(settings.locked === true);
    const collapseBtn = document.getElementById('float-collapse');
    // The gear in any titlebar opens Settings (docs/LAYOUT.md, N2).
    // Settings is reached from the tray menu and the `session` module (docs/LAYOUT.md, "One
    // palette"), so a float has no gear of its own.
    if (collapseBtn) collapseBtn.addEventListener('click', () => board.toggleFloatCollapsed());
    const boardReady = board.init().catch((err) => {
      console.error('[float] could not build the board', err);
      boardEl.replaceChildren();
      const note = document.createElement('div');
      note.className = 'float-fallback';
      note.textContent = window.Iro.t('ui.float.loadFailed');
      boardEl.append(note);
    });

    await loadProof();
    if (snapshot.color) store.applyIncoming(snapshot.color);
    await boardReady;

    board.bindPaletteName(document.getElementById('palette-name'));
    board.bindUnsnap(document.getElementById('btn-unsnap'));
    board.bindPaletteMenu({
      button: document.getElementById('btn-menu'),
      menu: document.getElementById('palette-menu'),
      nameInput: document.getElementById('palette-name'),
    });
    // A float is a non-activating window too, so its text fields need the same brief
    // focusability the palette's have. Delegated, so fields a module renders later
    // are covered as well.
    if (window.Iro.wireEditableFields) window.Iro.wireEditableFields(csp);
    // The float's header drags the *window*, through our own drag session: the palette hides
    // and only its name chip follows, and main moves the whole snap group. Module headers are
    // excluded so dragging a module still works (docs/LAYOUT.md, "Snap zones").
    const grip = document.getElementById('float-grip');
    if (grip) {
      grip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        // The locked layout does not move.
        if (board.locked) return;
        if (e.target.closest('#float-settings, #float-module-settings, #float-collapse, #btn-unsnap, #btn-menu, #palette-menu, #palette-name, .module-head, .module-body')) return;
        try { grip.setPointerCapture(e.pointerId); } catch { /* in-window only */ }
        const name = document.getElementById('palette-name');
        csp.dragBegin({ kind: 'palette', text: (name && name.value) || '' });
      });
      // A release anywhere in the window ends it, not just one on the grip.
      window.addEventListener('pointerup', () => csp.dragDrop());
      window.addEventListener('pointercancel', () => csp.dragCancel());
    }
    // The palette's safety nets (app.js) apply here too: a lost release must not leave
    // the store "dragging" (applyIncoming would stop following CSP), and a click
    // anywhere in this window closes an open module-settings popout.
    window.addEventListener('pointerup', () => { store.dragging = false; });
    window.addEventListener('blur', () => { store.dragging = false; window.dispatchEvent(new Event('iro:input-reset')); });
    document.addEventListener('pointerdown', () => csp.closeModuleSettings(), true);
    if (csp.onInputReset) {
      csp.onInputReset(() => {
        if (document.exitPointerLock) document.exitPointerLock();
        window.dispatchEvent(new Event('iro:input-reset'));
      });
    }
    // `--trace-input`: log what this page receives (docs/DEV.md).
    if (window.IroInputReset && window.IroInputReset.trace) window.IroInputReset.trace(csp);
    window.addEventListener('pointerdown', () => { if (csp.inputPress) csp.inputPress(); }, true);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') window.dispatchEvent(new Event('iro:input-reset'));
    }, true);
    // A collapsed float stays collapsed across a restart. Asking (rather than
    // being pushed to) keeps a push from arriving before the board exists.
    if (csp.paletteState) {
      const applyPaletteState = (state) => {
        if (!state) return;
        // A lone module shows its container while it is in a snap group (docs/LAYOUT.md,
        // "Snap zones"): the container is then draggable as a window, and the module by its
        // own header.
        document.body.classList.toggle('float-attached', state.attached === true);
        if (state.collapsed) board.toggleFloatCollapsed(true);
    };
      try {
        applyPaletteState(await csp.paletteState());
      } catch {
        /* leave it expanded */
      }
      // Joining is a drop, so the state changes while the window is open.
      if (csp.onLayoutChanged) csp.onLayoutChanged(() => { csp.paletteState().then(applyPaletteState).catch(() => {}); });
    }

    if (window.Iro.state && window.Iro.state.mode === 'model') {
      window.Iro.stateAdapters.connection(onStatus);
      window.Iro.stateAdapters.color((color) => store.applyIncoming(color));
      window.Iro.stateAdapters.history(store);
      window.Iro.stateAdapters.layout((layout) => board.applyLayout(layout));
      window.Iro.stateAdapters.health((v) => { window.Iro.health = v; });
    } else {
      csp.onColor((color) => store.applyIncoming(color));
      csp.onStatus(onStatus);
      // Main keeps the shared history, so a module floated out keeps it.
      if (csp.onHistoryChanged) csp.onHistoryChanged((list) => store.setHistory(list));
    }
    if (csp.onColorPreview) csp.onColorPreview((color) => store.applyPreview(color));
    csp.onSettings((s) => { applySettings(s); board.setLocked(s.locked === true); });
    try { store.setHistory(await csp.getHistory()); } catch { /* start empty */ }
  }

  init();
})();

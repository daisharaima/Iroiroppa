'use strict';

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
  window.__store = store;
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

    try { window.IroModuleManifest.register(csp.userModules()); } catch {  }
    await themeRegistry.load();
    const snapshot = await csp.snapshot();
  settings = { ...(snapshot.settings || {}) };

  appliedLanguage = settings.language || navigator.language || 'en';
  try { await window.Iro.i18n.use(appliedLanguage); } catch {  }
    applyNameSetting(settings);
    store.liveSync = settings.liveSync !== false;
  store.setViewFamily(settings.viewFamily);
  store.historyGate = settings.historyGate === true;
  store.markOutOfDisplay = settings.markOutOfDisplay === true;
    store.mode = modeOf(settings);
    store.connected = Boolean(snapshot.status && snapshot.status.state === 'connected');
    themeRegistry.apply(settings.theme, settings.accents || {});

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
    window.__board = board;

    window.addEventListener('theme-structural', () => board.remeasure());
    board.setLocked(settings.locked === true);
    const collapseBtn = document.getElementById('float-collapse');

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

    if (window.Iro.wireEditableFields) window.Iro.wireEditableFields(csp);

    const grip = document.getElementById('float-grip');
    if (grip) {
      grip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;

        if (board.locked) return;
        if (e.target.closest('#float-settings, #float-module-settings, #float-collapse, #btn-unsnap, #btn-menu, #palette-menu, #palette-name, .module-head, .module-body')) return;
        try { grip.setPointerCapture(e.pointerId); } catch {  }
        const name = document.getElementById('palette-name');
        csp.dragBegin({ kind: 'palette', text: (name && name.value) || '' });
      });

      window.addEventListener('pointerup', () => csp.dragDrop());
      window.addEventListener('pointercancel', () => csp.dragCancel());
    }

    window.addEventListener('pointerup', () => { store.dragging = false; });
    window.addEventListener('blur', () => { store.dragging = false; window.dispatchEvent(new Event('iro:input-reset')); });
    document.addEventListener('pointerdown', () => csp.closeModuleSettings(), true);
    if (csp.onInputReset) {
      csp.onInputReset(() => {
        if (document.exitPointerLock) document.exitPointerLock();
        window.dispatchEvent(new Event('iro:input-reset'));
      });
    }

    if (window.IroInputReset && window.IroInputReset.trace) window.IroInputReset.trace(csp);
    window.addEventListener('pointerdown', () => { if (csp.inputPress) csp.inputPress(); }, true);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') window.dispatchEvent(new Event('iro:input-reset'));
    }, true);

    if (csp.paletteState) {
      const applyPaletteState = (state) => {
        if (!state) return;

        document.body.classList.toggle('float-attached', state.attached === true);
        if (state.collapsed) board.toggleFloatCollapsed(true);
    };
      try {
        applyPaletteState(await csp.paletteState());
      } catch {

      }

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

      if (csp.onInteractionReject) csp.onInteractionReject(() => store.onInteractionReject());

      if (csp.onHistoryChanged) csp.onHistoryChanged((list) => store.setHistory(list));
    }
    if (csp.onColorPreview) csp.onColorPreview((color) => store.applyPreview(color));
    csp.onSettings((s) => { applySettings(s); board.setLocked(s.locked === true); });
    try { store.setHistory(await csp.getHistory()); } catch {  }
  }

  init();
})();

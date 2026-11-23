'use strict';

(function () {
  const Color = window.Color;
  const Proof = window.Proof;
  const $ = (id) => document.getElementById(id);
  const csp = window.csp;

  window.addEventListener('error', (e) => {
    window.__renderError = String((e.error && e.error.stack) || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    window.__renderError = String((e.reason && e.reason.stack) || e.reason);
  });

  const el = {
    btnCollapse: $('btn-collapse'),
  };

  const capabilities = window.Iro.createCapabilityStore();
  capabilities.refresh();

  const store = new window.Iro.ColorStore({ csp });
  window.__store = store;
  const themeRegistry = new window.Iro.ThemeRegistry();

  const chrome = {
    settings: {},
    scanning: false,
    profiles: [],
  };

  const MODES = ['default', 'proof'];

  const boardEl = $('board');
  const host = new window.Iro.ModuleHost({ root: boardEl, color: store, csp, capabilities });

  try { window.IroModuleManifest.register(window.csp.userModules()); } catch {  }
  const MODULE_IDS = window.IroModuleManifest.ids();

  const DEFAULT_LAYOUT = {
    version: 1,
    floats: [],
    columns: [{
      id: 'c1',
      width: null,
      modules: window.IroModuleManifest.defaultIds().map((moduleId, i) => {

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

  const modelMode = Boolean(window.Iro.state && window.Iro.state.mode === 'model');
  const board = new window.Iro.Board({
    root: boardEl, host, csp, defaultLayout: DEFAULT_LAYOUT, subscribe: !modelMode,

    load: () => csp.getPaletteColumns(),
    save: (layout) => csp.setPaletteColumns(layout.columns),
  });
  window.__board = board;

  window.addEventListener('theme-structural', () => board.remeasure());

  /** The palette window's own chrome is gone: the colour's numbers are the `color-stat` module,
   *  the connection and the profile are the `session` module, and both live in *every* palette
   *  (docs/LAYOUT.md, "One palette"). What is left here is the board's own state. */
  function renderChrome() {
    boardEl.dataset.transparent = store.transparent ? 'true' : 'false';
  }

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

  /** Re-read the proof profile and re-interpret the stored colour (nothing is
   * written to CSP — the stored value has not changed, only how we read it). */
  async function refreshProfile() {
    await loadProof();
    store.reinterpret();
  }

  /**
   * Native-helper health: a dot that is invisible while everything runs on the host, amber when
   * a capability fell back to PowerShell, red when one stopped. A silently dead hook looks exactly
   * like "the user did not press it", so this has to be visible without opening Settings.
   */
  function showHelperHealth(state) {
    const dot = document.getElementById('helper-health');
    if (!dot) return;
    const helpers = state && state.helpers;
    if (!helpers || helpers.state === 'healthy' || helpers.state === 'unknown'
      || (!(helpers.onFallback || []).length && !(helpers.unavailable || []).length)) {
      dot.className = 'helper-health hidden';
      dot.removeAttribute('data-tip');
      return;
    }
    const parts = [];
    if (helpers.onFallback && helpers.onFallback.length) parts.push(`on PowerShell: ${helpers.onFallback.join(', ')}`);
    if (helpers.unavailable && helpers.unavailable.length) parts.push(`stopped: ${helpers.unavailable.join(', ')}`);
    dot.className = `helper-health${helpers.state === 'down' ? ' down' : ''}`;
    dot.setAttribute('data-tip', `Native helpers degraded — ${parts.join('; ')}`);
    dot.setAttribute('aria-label', `Native helpers degraded — ${parts.join('; ')}`);
  }

  async function setMode(mode) {
    if (!MODES.includes(mode)) return;
    store.mode = mode;
    csp.updateSettings({ proofMode: mode });
    if (mode !== 'default' && !store.proof) await loadProof();

    store.reinterpret();
  }

  function applySettings(s) {
    const prev = chrome.settings || {};
    chrome.settings = { ...s };

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

      refreshProfile();
    } else if (model !== prev.proofModel && store.proofInfo && store.proofInfo.ok) {
      store.proof = Proof.createProof(store.proofInfo.profile, model);
      store.notify();
    }

    const wantMode = s.proofMode === 'default' ? 'default' : 'proof';
    if (wantMode !== store.mode) setMode(wantMode);
  }

  function updateStatus(status) {
    const wasConnected = store.connected;
    store.connected = status.state === 'connected';
    chrome.scanning = status.state === 'scanning';

    if (!wasConnected && store.connected && store.pendingSend) store.flushPending();
  }

  /** The title bar moves the window by hand, so a click on it still reaches the
   * page (an app-region drag would swallow it, and a click should close any
   * open popout). */
  function attachTitlebarDrag() {
    const bar = $('titlebar');
    if (!bar) return;

    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;

      if (board && board.locked) return;

      if (e.target.closest('.title-actions, #btn-unsnap, #btn-collapse, #btn-settings, #palette-name, #palette-menu')) return;
      try { bar.setPointerCapture(e.pointerId); } catch {  }
      const name = $('palette-name');
      csp.dragBegin({ kind: 'palette', text: (name && name.value) || '' });
    });

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

    if (csp.paletteState) {
      csp.paletteState()
        .then((state) => {
          if (state && state.collapsed) applyCollapsed(true);
        })
        .catch(() => {  });
    }

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

    store.subscribe(renderChrome);

    if (csp.onHelpersState) csp.onHelpersState(showHelperHealth);
    if (csp.helpersState) csp.helpersState().then(showHelperHealth).catch(() => {});
    if (window.Iro.state && window.Iro.state.mode === 'model') {

      window.Iro.stateAdapters.capabilities(capabilities);
      window.Iro.stateAdapters.connection(updateStatus);
      window.Iro.stateAdapters.color((color) => store.applyIncoming(color));
      window.Iro.stateAdapters.history(store);
      window.Iro.stateAdapters.layout((layout) => board.applyLayout(layout));
      window.Iro.stateAdapters.health((v) => { window.Iro.health = v; showHelperHealth(v); });
    } else {
      csp.onStatus(updateStatus);
      csp.onColor((color) => store.applyIncoming(color));

      if (csp.onInteractionReject) csp.onInteractionReject(() => store.onInteractionReject());

      if (csp.onHistoryChanged) csp.onHistoryChanged((list) => store.setHistory(list));
    }
    if (csp.onColorPreview) csp.onColorPreview((color) => store.applyPreview(color));
    csp.onSettings(applySettings);
  }

  async function init() {
    wire();
    await themeRegistry.load();

    let snap = null;
    try {
      snap = await csp.snapshot();
      const lang = (snap.settings && snap.settings.language) || navigator.language || 'en';
      await window.Iro.i18n.use(lang);
    } catch {  }

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

      const mode = snap.settings.proofMode === 'softproof' ? 'proof' : snap.settings.proofMode;
      await setMode(mode);
    }
    updateStatus(snap.status);
    if (snap.color) store.applyIncoming(snap.color);
    try { store.setHistory(await csp.getHistory()); } catch {  }
    store.notify();

    if (csp.holdInteraction && csp.localFirst) {
      setTimeout(() => {
        const l = store.lch();
        store.setLCH({ L: l.L, C: Math.min(l.C + 0.004, 0.4), H: l.H }, { notify: 'live' });
      }, 2500);
    }
  }

  init();
})();

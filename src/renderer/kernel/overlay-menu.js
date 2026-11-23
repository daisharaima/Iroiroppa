'use strict';

(function () {
  const csp = window.csp;
  const state = { kind: null, trigger: null };

  /**
   * Ask main to show the overlay menu.
   * @param {string} kind which menu (forwarded back with the pick)
   * @param {Element|null} trigger the button that opened it; clicks inside it do not
   *   close the menu (so the button can toggle it)
   * @param {object} spec `{ items, anchor, width?, maxHeight? }`
   */
  function show(kind, trigger, spec = {}) {
    if (!csp || typeof csp.showPaletteMenu !== 'function') return false;
    state.kind = kind;
    state.trigger = trigger || null;
    csp.showPaletteMenu({ ...spec, menu: kind });
    return true;
  }

  function close() {
    state.kind = null;
    state.trigger = null;
    if (csp && typeof csp.overlayMenuClose === 'function') csp.overlayMenuClose();
  }

  const kind = () => state.kind;

  const handlers = new Map();

  /** @param {string} menu @param {(id: string) => void} fn */
  function onPick(menu, fn) {
    if (typeof menu === 'string' && typeof fn === 'function') handlers.set(menu, fn);
  }

  document.addEventListener('pointerdown', (event) => {
    if (!state.kind) return;
    if (state.trigger && (state.trigger === event.target || state.trigger.contains(event.target))) return;

    if (event.target && event.target.closest && event.target.closest('#palette-menu')) return;
    close();
  }, true);

  if (csp && typeof csp.onPaletteMenuPick === 'function') {
    csp.onPaletteMenuPick((pick) => {
      const menu = (pick && pick.menu) || state.kind;
      const id = pick && pick.id;
      state.kind = null;
      state.trigger = null;
      const fn = handlers.get(menu);
      if (fn && id !== undefined) fn(id);
    });
  }

  window.Iro = window.Iro || {};
  window.Iro.overlayMenu = { show, close, kind, onPick };
})();

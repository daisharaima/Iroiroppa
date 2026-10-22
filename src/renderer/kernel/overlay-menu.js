'use strict';

// One owner for the overlay menus in this window.
//
// The palette's ☰ menu and the Session profile picker are both drawn by the overlay
// window (a renderer cannot paint outside its own window), and both need the same
// "a click anywhere else closes it" rule. Owning it here means opening one menu
// closes the other and neither has to know about the other's trigger.

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

  document.addEventListener('pointerdown', (event) => {
    if (!state.kind) return;
    if (state.trigger && (state.trigger === event.target || state.trigger.contains(event.target))) return;
    // The in-window fallback menu (only when the overlay is unavailable) owns its own clicks.
    if (event.target && event.target.closest && event.target.closest('#palette-menu')) return;
    close();
  }, true);

  if (csp && typeof csp.onPaletteMenuPick === 'function') {
    csp.onPaletteMenuPick(() => { state.kind = null; state.trigger = null; });
  }

  window.Iro = window.Iro || {};
  window.Iro.overlayMenu = { show, close, kind };
})();

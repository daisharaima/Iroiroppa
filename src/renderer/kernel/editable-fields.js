'use strict';

// Text entry needs real OS focus: the palette and its floats are non-activating
// windows, so clicking a field must briefly make the window focusable
// (docs/ARCHITECTURE.md, docs/STATE.md).
//
// One delegated listener, not one per node: a module's render() replaces its fields
// after boot, and per-node wiring left every later field dead until a restart.

(function () {
  const FIELDS = 'input:not([type="range"]), select, textarea';
  let installed = false;
  let blurTimer = null;

  /** Install the delegated focusability wiring. Safe to call more than once. */
  function wireEditableFields(csp) {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    const editable = (on) => { try { csp.setEditable(on); } catch { /* window gone */ } };
    const fieldIn = (event) => (event.target && event.target.closest ? event.target.closest(FIELDS) : null);

    document.addEventListener('pointerdown', (event) => {
      const field = fieldIn(event);
      if (!field) return;
      // A click that lands in another field before the old one blurs must not be
      // switched off by that blur: cancel the pending off, then stay editable.
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
      editable(true);
      setTimeout(() => { try { field.focus(); } catch { /* ignore */ } }, 60);
    }, true);

    document.addEventListener('focusout', (event) => {
      if (!fieldIn(event)) return;
      if (blurTimer) clearTimeout(blurTimer);
      // Deferred to the next task, so a focus that is already moving to another
      // field wins over this one's blur.
      blurTimer = setTimeout(() => {
        blurTimer = null;
        const active = document.activeElement;
        if (!active || typeof active.closest !== 'function' || !active.closest(FIELDS)) editable(false);
      }, 0);
    }, true);
  }

  window.Iro = window.Iro || {};
  window.Iro.wireEditableFields = wireEditableFields;
})();

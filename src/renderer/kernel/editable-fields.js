'use strict';

(function () {
  const FIELDS = 'input:not([type="range"]), select, textarea';
  let installed = false;
  let blurTimer = null;

  /** Install the delegated focusability wiring. Safe to call more than once. */
  function wireEditableFields({ setEditable } = {}) {
    if (typeof setEditable !== 'function') throw new TypeError('wireEditableFields needs { setEditable }');
    if (installed || typeof document === 'undefined') return;
    installed = true;
    const editable = (on) => { try { setEditable(on); } catch {  } };
    const fieldIn = (event) => (event.target && event.target.closest ? event.target.closest(FIELDS) : null);

    document.addEventListener('pointerdown', (event) => {
      const field = fieldIn(event);
      if (!field) return;

      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
      editable(true);
      setTimeout(() => { try { field.focus(); } catch {  } }, 60);
    }, true);

    document.addEventListener('focusout', (event) => {
      if (!fieldIn(event)) return;
      if (blurTimer) clearTimeout(blurTimer);

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

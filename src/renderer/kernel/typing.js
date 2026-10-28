'use strict';

// Tell main when a text-entry control in this window has focus. Bare-key
// shortcuts use a low-level keyboard hook, and that hook must pass the key
// through while the user is naming a layer, searching, editing a hex value, or
// recording a new shortcut.

(function () {
  const csp = window.csp;
  if (!csp || typeof csp.uiTyping !== 'function') return;

  const NON_TEXT_INPUT = new Set([
    'button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image',
  ]);

  function isTextEntry(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    if (tag === 'input') return !NON_TEXT_INPUT.has(String(el.type || 'text').toLowerCase());
    return false;
  }

  let last = false;
  const report = (on) => {
    if (on === last) return;
    last = on;
    try { csp.uiTyping(on); } catch { /* the app is closing */ }
  };

  document.addEventListener('focusin', (event) => report(isTextEntry(event.target)), true);
  document.addEventListener('focusout', () => {
    // focusout fires before the new target receives focus; defer one task so a
    // focus move between fields does not briefly un-suppress the hook.
    setTimeout(() => report(isTextEntry(document.activeElement)), 0);
  }, true);
  window.addEventListener('blur', () => report(false));
  window.addEventListener('pagehide', () => report(false));
})();

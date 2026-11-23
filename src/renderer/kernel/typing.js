'use strict';

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
    try { csp.uiTyping(on); } catch {  }
  };

  document.addEventListener('focusin', (event) => report(isTextEntry(event.target)), true);
  document.addEventListener('focusout', () => {

    setTimeout(() => report(isTextEntry(document.activeElement)), 0);
  }, true);
  window.addEventListener('blur', () => report(false));
  window.addEventListener('pagehide', () => report(false));
})();

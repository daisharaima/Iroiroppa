'use strict';

// Tooltips that cannot be buried.
//
// A native `title=` tooltip is an OS window outside our always-on-top band, so a palette
// or the Settings window covered it. Every element with `data-tip="…"` asks main to draw
// the tooltip on the overlay surface instead (full desktop, always-on-top, click-through)
// — see `showTooltip` in src/main/windows.js.

(function () {
  const csp = window.csp;
  if (!csp || typeof csp.tooltipShow !== 'function') return;

  const DELAY = 220;
  let timer = 0;
  let current = null;

  const hide = () => {
    if (timer) { clearTimeout(timer); timer = 0; }
    current = null;
    if (typeof csp.tooltipHide === 'function') csp.tooltipHide();
  };

  const tipOf = (el) => (el && el.getAttribute ? el.getAttribute('data-tip') : '');

  document.addEventListener('pointerover', (event) => {
    const el = event.target && event.target.closest ? event.target.closest('[data-tip]') : null;
    if (!el || el === current) return;
    current = el;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      const text = tipOf(el);
      if (!text) return;
      const r = el.getBoundingClientRect();
      csp.tooltipShow({
        text,
        // Screen coordinates: the overlay is a separate, full-desktop window.
        x: Math.round(window.screenX + r.left),
        y: Math.round(window.screenY + r.bottom),
      });
    }, DELAY);
  });

  document.addEventListener('pointerout', (event) => {
    const el = event.target && event.target.closest ? event.target.closest('[data-tip]') : null;
    if (el && el === current) hide();
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
  window.addEventListener('blur', hide);

  window.Iro = window.Iro || {};
  window.Iro.tooltip = { hide };

  // i18n may have run before this script (it sets `title` from `data-i18n-title`):
  // move those onto `data-tip` so they use the overlay too.
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    if (!el.getAttribute('data-tip') && el.title) el.setAttribute('data-tip', el.title);
    el.removeAttribute('title');
  }
})();

'use strict';

// Native <select> popups are OS windows outside Iroiroppa's always-on-top band,
// so inside the Settings window (or a module-settings popover) the list is drawn
// *behind* the window. This enhancement keeps the select element and its change
// event, but opens the list on the overlay surface instead of the OS popup.
//
// It is deliberately progressive: with no overlay API (test pages, a bare
// renderer) the select is left completely native.

(function () {
  const overlay = window.Iro && window.Iro.overlayMenu;
  const canOverlay = Boolean(overlay && typeof overlay.show === 'function'
    && window.csp && typeof window.csp.showPaletteMenu === 'function');
  if (!canOverlay) return;

  let seq = 0;

  function itemsFor(select) {
    const items = [];
    let group = null;
    for (const option of select.options) {
      const parent = option.parentElement;
      if (parent && parent.tagName === 'OPTGROUP' && parent.label && parent.label !== group) {
        group = parent.label;
        items.push({ kind: 'heading', label: group });
      }
      items.push({ id: option.value, label: option.textContent || option.value });
    }
    return items;
  }

  function open(select) {
    if (!select || select.disabled || select.multiple || select.size > 1) return false;
    const items = itemsFor(select);
    if (!items.length) return false;
    const rect = select.getBoundingClientRect();
    const menuId = `select:${(seq += 1)}`;
    overlay.onPick(menuId, (id) => {
      if (id === undefined) return;
      if (select.value !== id) {
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    overlay.show(menuId, select, {
      items,
      anchor: {
        x: Math.round(window.screenX + rect.left),
        y: Math.round(window.screenY + rect.bottom + 2),
      },
      width: Math.max(120, Math.round(rect.width)),
      maxRows: 12,
    });
    return true;
  }

  function enhance(select) {
    if (!select || select.dataset.overlaySelect === '1') return;
    if (select.disabled || select.multiple || select.size > 1) return;
    select.dataset.overlaySelect = '1';
    select.setAttribute('aria-haspopup', 'listbox');

    let justOpened = 0;
    const press = (event) => {
      if (event.button && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      justOpened = Date.now();
      try { select.focus({ preventScroll: true }); } catch { try { select.focus(); } catch { /* ignore */ } }
      open(select);
    };
    // Capture both: Chromium opens the OS popup on the mousedown default action,
    // while pointerdown lets us steal it a little earlier.
    select.addEventListener('pointerdown', press, true);
    select.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    select.addEventListener('click', (event) => {
      // Some platforms deliver the click after a prevented mousedown. A real click
      // that did not produce a pointerdown (a synthetic/settings click) still opens.
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - justOpened >= 300) open(select);
    }, true);
    select.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        open(select);
      }
    });
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    for (const select of root.querySelectorAll('select')) enhance(select);
    if (root.matches && root.matches('select')) enhance(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan(document));
  } else {
    scan(document);
  }
  // Module settings and the Shortcuts tab create selects after load.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node && node.nodeType === 1) scan(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

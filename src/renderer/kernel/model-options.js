/*
 * Model dropdowns, grouped by colour-model family — and drawn *inside the page*.
 *
 * Two things this has to get right:
 *
 * 1. The model list is one long row of names (OKLCH, OKLab, CIELAB, CIELCH, OKHSV,
 *    OKHSL, OKHWB, HelmGen LCH, HelmGen). Every module's Model control groups them
 *    under their family — OKLab first, then CIELAB, then HelmGen — using the existing
 *    `settings.family.*` labels. A module filters the list to what it can draw;
 *    grouping never reorders within a family.
 *
 * 2. A native <select> opens its list in a separate OS window, which is *not* in the
 *    topmost band the palette and its tool windows live in — so inside the module
 *    settings popup and the Settings window the dropdown was drawn *behind* the page.
 *    `menu()` builds the same control as a button plus an in-page list instead.
 *
 * Loads as a global `IroModelOptions` (classic script, before the modules).
 */
(function () {
  'use strict';

  // The user-facing order: the OK family first, then CIELAB, then HelmGen.
  const ORDER = ['oklab', 'cielab', 'helmgen', 'hct'];
  // Used only if the active locale has no `settings.family.<id>` label.
  const FALLBACK = { oklab: 'OKLab', cielab: 'CIELAB', helmgen: 'HelmGen', hct: 'HCT' };

  const labelFor = (family) => {
    const key = `settings.family.${family}`;
    const t = window.Iro && typeof window.Iro.t === 'function' ? window.Iro.t(key) : key;
    return t === key ? FALLBACK[family] || family : t;
  };

  const rank = (family) => {
    const i = ORDER.indexOf(family);
    return i < 0 ? ORDER.length : i;
  };

  /**
   * Group models by family, in the user-facing order.
   * @returns {Array<{label: string, items: Array<{value: string, label: string}>}>}
   */
  function groups(models) {
    const byFamily = new Map();
    for (const m of models || []) {
      const family = (m && m.family) || 'oklab';
      const list = byFamily.get(family);
      if (list) list.push(m); else byFamily.set(family, [m]);
    }
    const families = [...byFamily.keys()].sort((a, b) => rank(a) - rank(b));
    return families.map((family) => ({
      label: labelFor(family),
      items: byFamily.get(family).map((m) => ({ value: m.id, label: m.name })),
    }));
  }

  let openMenu = null;
  let menuSeq = 0;

  /**
   * A dropdown. The real menu is the desktop overlay (the same surface the Session
   * profile picker and the palette menu use): a renderer cannot paint outside its own
   * window, so an in-page list was clipped by the content-fitted popups, and a native
   * <select> is buried because its OS list is not in the topmost band. Without an
   * overlay (a bare page, the tests) it falls back to the in-page list.
   *
   * @param {HTMLElement} host
   * @param {{groups?: Array<{label: string, items: Array}>, items?: Array, value?: string,
   *          onChange?: (value: string) => void}} opts
   * @returns {{el: HTMLElement, set: (value: string) => void, close: () => void}}
   */
  function menu(host, opts = {}) {
    const source = opts.groups || [{ label: '', items: opts.items || [] }];
    const flat = [];
    for (const g of source) for (const it of g.items || []) flat.push(it);

    const wrap = document.createElement('div');
    wrap.className = 'menu-picker';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pop-select menu-btn';
    const valueEl = document.createElement('span');
    valueEl.className = 'menu-value';
    const chev = document.createElement('span');
    chev.className = 'menu-chev';
    chev.innerHTML = '<svg viewBox="0 0 10 10"><path d="M2 3.5 5 6.5l3-3"/></svg>';
    btn.append(valueEl, chev);
    wrap.append(btn);
    host.append(wrap);

    let current = opts.value;
    let markList = null; // the fallback list's active row, set once the list exists
    const setValue = (value) => {
      current = value;
      const hit = flat.find((it) => it.value === value);
      valueEl.textContent = hit ? hit.label : '';
      if (markList) markList(value);
    };
    setValue(opts.value);

    const change = (value) => {
      if (value === current) return;
      setValue(value);
      if (typeof opts.onChange === 'function') opts.onChange(value);
    };

    const overlay = window.Iro && window.Iro.overlayMenu;
    const hasOverlay = Boolean(overlay && typeof overlay.show === 'function'
      && window.csp && typeof window.csp.showPaletteMenu === 'function');

    // The overlay item list: one heading per family, every model a row.
    const overlayItems = [];
    for (const g of source) {
      if (!g.items || !g.items.length) continue;
      // A family with a single model named exactly like the family (CIELAB, HelmGen)
      // needs no heading — it would just repeat the item line.
      const repeat = g.items.length === 1 && g.items[0].label === g.label;
      if (g.label && !repeat) overlayItems.push({ kind: 'heading', label: g.label });
      for (const it of g.items) overlayItems.push({ id: it.value, label: it.label });
    }

    if (hasOverlay) {
      // Every widget gets its own menu id and registers its pick handler *on open*:
      // registering them all as 'model' at build time made the last-built menu win, so
      // the Slices' model menu and the Slider's other dropdowns stole each other's picks
      // ("switching colour model is impossible").
      const menuId = `model:${(menuSeq += 1)}`;
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const rect = btn.getBoundingClientRect();
        overlay.onPick(menuId, (id) => { if (id) change(id); });
        overlay.show(menuId, btn, {
          items: overlayItems,
          anchor: {
            x: Math.round(window.screenX + rect.left),
            y: Math.round(window.screenY + rect.bottom + 2),
          },
          width: Math.round(rect.width + 80),
          maxRows: 12,
        });
      });
      return { el: wrap, set: setValue, close: () => {} };
    }

    const list = document.createElement('div');
    list.className = 'menu-list';
    list.hidden = true;
    for (const g of source) {
      if (!g.items || !g.items.length) continue;
      // A family with a single model named exactly like the family (CIELAB, HelmGen)
      // needs no heading — it would just repeat the item line.
      const repeat = g.items.length === 1 && g.items[0].label === g.label;
      if (g.label && !repeat) {
        const head = document.createElement('div');
        head.className = 'menu-group';
        head.textContent = g.label;
        list.append(head);
      }
      for (const it of g.items) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'menu-item';
        item.dataset.value = it.value;
        item.textContent = it.label;
        item.addEventListener('click', (ev) => {
          ev.preventDefault();
          close();
          setValue(it.value);
          if (typeof opts.onChange === 'function') opts.onChange(it.value);
        });
        list.append(item);
      }
    }
    wrap.append(btn);
    host.append(wrap);
    // The list goes *after* the row, in the page flow, and is placed on first open —
    // the caller appends the row to its settings body only after building it, so
    // host.parentElement is still null here. Positioned absolutely it was clipped by the
    // content-fitted popup window and by the Settings tab's column.
    const listHost = () => host.parentElement || host;

    // The fallback list mirrors the value too (the overlay path never builds one).
    markList = (value) => {
      if (!list || !list.children) return;
      for (const item of list.children) {
        if (item.dataset && item.dataset.value !== undefined) {
          item.classList.toggle('active', item.dataset.value === value);
        }
      }
    };
    markList(opts.value);

    // The list is a sibling of the row, so an outside click has to clear *both* — and a
    // click on an item must not close the menu on its own pointerdown, or the click that
    // follows lands on nothing and the model never changes.
    const onDocDown = (ev) => { if (!wrap.contains(ev.target) && !list.contains(ev.target)) close(); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    function close() {
      if (list.hidden) return;
      list.hidden = true;
      wrap.classList.remove('open');
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey);
      if (openMenu === api) openMenu = null;
    }
    function open() {
      if (openMenu && openMenu !== api) openMenu.close();
      openMenu = api;
      if (!list.parentElement) listHost().insertBefore(list, host.nextSibling);
      list.hidden = false;
      wrap.classList.add('open');
      document.addEventListener('pointerdown', onDocDown, true);
      document.addEventListener('keydown', onKey);
      if (typeof list.scrollIntoView === 'function') {
        list.scrollIntoView({ block: 'nearest' });
      }
    }
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (list.hidden) open(); else close();
    });
    const api = { el: wrap, set: setValue, close };
    return api;
  }

  window.IroModelOptions = { groups, labelFor, menu };
})();

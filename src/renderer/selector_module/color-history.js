'use strict';

// Selector module: Colour History — the most recently stored colours, newest
// first; clicking a chip re-selects it. The Companion protocol has no history
// command, so this is the app's own log of the colours it has seen and picked.

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};

  // The drawing-only gate is one global setting, not a per-instance one. Every
  // History settings panel (popover and Settings window) edits the same value;
  // one listener keeps all live panels in step.
  const gateBoxes = new Set();
  let gateListening = false;
  let gateSynced = false;

  const addGateRow = (root) => {
    const row = document.createElement('label');
    row.className = 'pop-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    const name = document.createElement('span');
    name.textContent = 'Record only while drawing';
    name.title = 'A canvas contact (pen or mouse) records the current colour; picking alone does not. Alt contacts do not count.';
    row.append(box, name);
    root.append(row);

    const csp = window.csp;
    gateBoxes.add(box);
    if (!gateListening && csp && csp.onSettings) {
      gateListening = true;
      csp.onSettings((s) => {
        gateSynced = true;
        for (const b of [...gateBoxes]) {
          if (!b.isConnected) { gateBoxes.delete(b); continue; }
          b.checked = Boolean(s && s.historyGate);
        }
      });
    }
    if (csp && csp.snapshot) {
      csp.snapshot().then((s) => {
        if (!gateSynced && !box.dataset.touched) box.checked = Boolean(s && s.settings && s.settings.historyGate);
      }).catch(() => {});
    }
    box.addEventListener('change', () => {
      box.dataset.touched = '1';
      if (!csp || !csp.updateSettings) return;
      const p = csp.updateSettings({ historyGate: box.checked });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    });
  };

  /** The history settings UI, shared by the popover and the Settings window. */
  const settingsUI = (api, root) => {
    addGateRow(root);
    const addRange = (key, label, min, max, step, fallback, suffix) => {
      const row = document.createElement('label');
      row.className = 'pop-row pop-row-range';
      const name = document.createElement('span');
      name.textContent = label;
      const rng = document.createElement('input');
      rng.type = 'range';
      rng.className = 'pop-range';
      rng.min = String(min);
      rng.max = String(max);
      rng.step = String(step);
      const value = Number(api.get()[key]);
      rng.value = String(Number.isFinite(value) ? value : fallback);
      const out = document.createElement('span');
      out.className = 'pop-range-value';
      const show = (v) => { out.textContent = suffix ? `${v}${suffix}` : String(v); };
      show(rng.value);
      rng.addEventListener('input', () => { api.patch({ [key]: Number(rng.value) }); show(rng.value); });
      row.append(name, rng, out);
      root.append(row);
    };
    addRange('tile', 'Tile size', 12, 48, 1, 24, 'px');
    addRange('maxHistory', 'Max colours', 1, 100, 1, 100);
  };

  const tileOf = (value) => Math.max(12, Math.min(48, Number(value) || 24));
  const maxOf = (value) => Math.max(1, Math.min(100, Number(value) || 100));

  reg.modules['color-history'] = {
    id: 'color-history',
    name: 'Color History',
    version: 3,
    defaults: { tile: 24, maxHistory: 100 },
    migrate(stored) {
      // v1 had a "columns" count instead of a tile size.
      if (stored && stored.columns !== undefined && stored.tile === undefined) {
        return { ...stored, tile: 24, columns: undefined };
      }
      // The old per-instance gate is a global setting now; drop the stale key.
      if (stored && stored.drawingOnly !== undefined) {
        const next = { ...stored };
        delete next.drawingOnly;
        return next;
      }
      return stored;
    },
    settingsUI,
    minSize(settings) {
      const tile = tileOf(settings.tile);
      return { width: tile * 3 + 16, height: 34 + tile };
    },

    create(ctx) {
      const Color = window.Color;
      const store = ctx.color;

      const grid = document.createElement('div');
      grid.className = 'history';
      ctx.el.append(grid);

      // History changes rarely (a settled pick), but the store emits on every
      // live drag. A signature guard skips the DOM rebuild unless the list or the
      // proof changed, and a rAF coalesces the rest.
      let lastKey = null;
      let maxHistory = 100;
      const renderNow = () => {
        const items = (store.history || []).slice(0, maxHistory);
        const key = `${store.mode}:${store.plotKeyTag()}:${items.map((c) => `${c.r},${c.g},${c.b}`).join('|')}`;
        if (key === lastKey) return;
        lastKey = key;
        grid.replaceChildren();
        if (!items.length) {
          const empty = document.createElement('div');
          empty.className = 'history-empty';
          empty.textContent = window.Iro.t('module.label.noColours');
          grid.append(empty);
          return;
        }
        for (const rgb of items) {
          const shown = store.appearanceFromRecorded(rgb) || rgb;
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'history-chip';
          chip.style.background = Color.rgbToHex(shown.r, shown.g, shown.b);
          chip.setAttribute('aria-label', Color.rgbToHex(rgb.r, rgb.g, rgb.b));
          chip.addEventListener('click', () => {
            store.applyRecordedRgb(rgb);
            store.push(true);
          });
          grid.append(chip);
        }
      };

      // History changes are rare, but an rAF scheduled while the palette is
      // hidden/occluded can stay paused: the data moves to the new head while the
      // grid keeps painting the previous one. renderNow() already skips unchanged
      // lists, so render synchronously instead of waiting for a frame.
      const render = () => renderNow();

      const applyTile = (value) => {
        grid.style.setProperty('--history-tile', `${tileOf(value)}px`);
      };

      const unsubscribe = store.subscribe(render);
      render();

      return {
        onSettings(settings) {
          applyTile(settings.tile);
          maxHistory = maxOf(settings.maxHistory);
          render();
        },
        settings(root) { settingsUI(ctx.settings, root); },
        destroy() { unsubscribe(); },
      };
    },
  };
})();

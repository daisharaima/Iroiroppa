'use strict';

// Selector module: Colour Stat — the colour in hand, and what it is, in **one line**:
//
//     [swatch]  #B1DAD1  ⧉   L85 C63 H184   [last] ΔE 8.4  ≠
//
// - The swatch and the HEX (copyable, pasteable, editable) are the colour in hand.
// - The **view cell** shows one set of coordinates at a time — the document's L/C/H, or the screen's
//   sRGB — and clicking it switches to the other. Two rows of numbers never share the row.
// - The ΔE compares against the colour stored before this one, with a swatch of that colour; both
//   carry a tooltip, because "8.4" on its own explains nothing.
//
// Two quantities live here and they are **not** the same thing (AGENTS.md): the swatch and the sRGB
// view are the colour **on screen**, while the HEX and the L/C/H view are what the document
// **stores**. With a proof profile active they differ, so the `≠` marker says so rather than letting
// the card pretend to be one number.
//
// It reads the shared colour store like any other module; it owns nothing but its own view choice.
//
// What the footer could also do, and where it went: the Slices module owns its own crosshair
// toggle now, and the layout lock is dropped for now.

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};

  // One source for the eraser's pattern: the shared value the palette used (window.Iro).
  const TRANSPARENT_CSS = (window.Iro && window.Iro.TRANSPARENT_CSS)
    || 'repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%) 50% / 12px 12px';

  const VIEWS = ['lch', 'rgb'];

  const settingsUI = (api, root) => {
    const row = document.createElement('label');
    row.className = 'pop-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = api.get().showRgb !== false;
    box.addEventListener('change', () => api.patch({ showRgb: box.checked }));
    const name = document.createElement('span');
    name.textContent = window.Iro.t('module.settings.includeSrgb');
    row.append(box, name);
    root.append(row);
  };

  reg.modules['color-stat'] = {
    id: 'color-stat',
    name: 'Color Stat',
    version: 1,
    defaults: { showRgb: true, view: 'lch' },
    autoHeight: true,
    // One line, and its height is not the user's to drag: it is a row of readings, like Session — and
    // it is `compact`, so the card head is an overlay on that row instead of a row above it.
    rigid: true,
    compact: true,
    settingsUI,
    // One line, always. The width is what the row needs at its narrowest readable shape.
    minSize() { return { width: 210, height: 26 }; },

    create(ctx) {
      const Color = window.Color;
      const store = ctx.color;
      let settings = Object.assign({}, ctx.settings || {});
      if (VIEWS.indexOf(settings.view) === -1) settings.view = 'lch';

      const root = document.createElement('div');
      root.className = 'color-stat color-stat-row';

      const swatch = document.createElement('span');
      swatch.className = 'swatch color-stat-swatch';
      const hexWrap = document.createElement('div');
      hexWrap.className = 'color-stat-hexwrap';
      const hex = document.createElement('input');
      hex.className = 'hex color-stat-hex';
      hex.spellcheck = false;
      hex.maxLength = 7;
      hex.readOnly = true;
      // The two zones are the field's halves: left copies, right pastes, and each shows its own name
      // while the pointer is over it. Double-click to type a hex by hand (the zones step aside).
      const zoneCopy = document.createElement('button');
      zoneCopy.type = 'button';
      zoneCopy.className = 'hex-zone hex-zone-left';
      zoneCopy.innerHTML = '<span>Copy</span>';
      const zonePaste = document.createElement('button');
      zonePaste.type = 'button';
      zonePaste.className = 'hex-zone hex-zone-right';
      zonePaste.innerHTML = '<span>Paste</span>';
      hexWrap.append(hex, zoneCopy, zonePaste);
      // The one data cell: it shows L/C/H *or* sRGB, never both, and a click switches. (There used to
      // be a ΔE-against-the-previous-colour row here with a swatch of that colour: it was removed —
      // for a picker, "how far from the colour I had a moment ago" is not what you are deciding, and
      // it cost the row the width the coordinates need.)
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'color-stat-view';

      root.append(swatch, hexWrap, view);
      ctx.el.append(root);

      const applyHex = (text) => {
        const parsed = Color.hexToRgb(String(text || '').trim());
        if (!parsed) return false;
        store.applyRecordedRgb(parsed);
        store.push(true);
        return true;
      };

      let copiedFlash = null;
      const flashCopied = () => {
        hex.classList.add('copied');
        hex.value = 'Copied!';
        if (copiedFlash) clearTimeout(copiedFlash);
        copiedFlash = setTimeout(() => {
          copiedFlash = null;
          hex.classList.remove('copied');
          render();
        }, 700);
      };

      hex.addEventListener('focus', () => { hex.select(); });
      hex.addEventListener('change', () => { if (!applyHex(hex.value)) render(); });
      hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') hex.blur(); });
      hex.addEventListener('input', () => {
        if (!copiedFlash) return;
        clearTimeout(copiedFlash);
        copiedFlash = null;
        hex.classList.remove('copied');
        hex.value = '';
      });
      // Editing by hand: a double-click (which is how you *reach* the field, since its halves are
      // action zones) unlocks the box and hides the zones; leaving it locks them again.
      hexWrap.addEventListener('dblclick', () => {
        hex.readOnly = false;
        hexWrap.classList.add('editing');
        hex.focus();
        hex.select();
      });
      hex.addEventListener('blur', () => {
        hex.readOnly = true;
        hexWrap.classList.remove('editing');
        render();
      });
      zoneCopy.addEventListener('click', () => {
        window.csp.copy(store.transparent ? '' : store.contentHex());
        flashCopied();
      });
      zonePaste.addEventListener('click', async () => {
        try {
          const text = await window.csp.readClipboard();
          if (!applyHex(text)) hex.focus();
        } catch { /* leaving the colour alone is the safe outcome */ }
      });
      view.addEventListener('click', () => {
        // Cycle: L/C/H -> sRGB -> L/C/H. The choice is saved, because the board rebuilds its cards
        // on every layout change and an in-memory choice would jump back.
        const usable = settings.showRgb === false ? ['lch'] : VIEWS;
        const at = usable.indexOf(settings.view);
        settings.view = usable[(at + 1) % usable.length];
        ctx.settings.patch({ view: settings.view });
        render();
      });

      const render = () => {
        const transparent = store.transparent;
        const shown = store.appearanceRgb();
        const shownHex = Color.rgbToHex(shown.r, shown.g, shown.b);
        const storedHex = store.contentHex();
        swatch.classList.toggle('transparent', transparent);
        swatch.style.background = transparent ? TRANSPARENT_CSS : shownHex;
        if (document.activeElement !== hex && !copiedFlash) {
          hex.value = transparent ? 'N/A' : storedHex;
        }
        const twoSpaces = !transparent && shownHex.toLowerCase() !== String(storedHex).toLowerCase();
        hexWrap.title = window.Iro.t('module.stat.hexHint');

        // The same display units the OKLCH sliders use (color-slider.js): L × 100, C × 1000,
        // H in degrees — one convention for the numbers, in one place. The first build read
        // "L 0.8 C 0.1" (the raw store values) and RGB off by 255×, both caught by a screenshot.
        const { L, C, H } = store.lch();
        const rgbOf = (h) => /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
        const m = rgbOf(shownHex);
        const hueDeg = ((H.toFixed(0) | 0) % 360 + 360) % 360;
        const lchText = `L${Math.round(L * 100)} C${Math.round(C * 1000)} H${hueDeg}`;
        const rgbText = m ? `R${parseInt(m[1], 16)} G${parseInt(m[2], 16)} B${parseInt(m[3], 16)}` : '';
        const usable = settings.showRgb === false ? ['lch'] : VIEWS;
        if (usable.indexOf(settings.view) === -1) settings.view = usable[0];
        view.textContent = settings.view === 'rgb' ? rgbText : lchText;
        view.dataset.view = settings.view;
        view.title = settings.view === 'rgb'
          ? 'sRGB, as it appears on screen — click for the document\'s L/C/H'
          : 'The document\'s colour — click for the on-screen sRGB';

        // ΔE against the previous stored colour is gone (see the note where the row is built).
      };

      const unsubscribe = store.subscribe(render);
      render();

      return {
        onSettings(next) {
          settings = Object.assign({}, next || {});
          if (VIEWS.indexOf(settings.view) === -1) settings.view = 'lch';
          render();
        },
        settings(rootEl) { settingsUI(ctx.settings, rootEl); },
        destroy() {
          if (copiedFlash) clearTimeout(copiedFlash);
          unsubscribe();
        },
      };
    },
  };
})();

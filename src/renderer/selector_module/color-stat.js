'use strict';



(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};


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

    rigid: true,
    compact: true,
    settingsUI,

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

      const zoneCopy = document.createElement('button');
      zoneCopy.type = 'button';
      zoneCopy.className = 'hex-zone hex-zone-left';
      zoneCopy.innerHTML = '<span>Copy</span>';
      const zonePaste = document.createElement('button');
      zonePaste.type = 'button';
      zonePaste.className = 'hex-zone hex-zone-right';
      zonePaste.innerHTML = '<span>Paste</span>';
      hexWrap.append(hex, zoneCopy, zonePaste);

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
        } catch {  }
      });
      view.addEventListener('click', () => {

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

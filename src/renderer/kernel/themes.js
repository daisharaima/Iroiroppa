'use strict';

// ThemeRegistry: applies a theme to the document.
//
// Two layers, both as <style> blocks so a theme can override anything:
//   1. the token set on :root (validated; the accent is derived here), and
//   2. the theme's optional CSS, injected *after* the tokens and the base sheets.
// The list of themes (tokens + css) comes from the main process, which reads the
// bundled `themes/*` plus the user's app-data `themes/` folder.
//
// The manifest (window.Iro.ThemeTokens, from src/shared/theme-tokens.js) fills in
// any token a theme omits and names the *structural* tokens. When a theme change
// moves a structural value the window must re-measure and re-clamp once, so the
// registry fires a `theme-structural` event (see Board#remeasure).

(function () {
  const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

  const parseHex = (hex) => {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const toHex = (rgb) => '#' + rgb
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');
  /** Mix `a` toward `b`; t=0 keeps a, t=1 gives b. */
  const mixHex = (a, b, t) => {
    const ca = parseHex(a);
    const cb = parseHex(b);
    if (!ca || !cb) return a;
    return toHex(ca.map((v, i) => v + (cb[i] - v) * t));
  };

  const relLuminance = ([r, g, b]) => {
    const lin = (c) => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  /** Ink that stays readable on a solid accent fill (white or near-black). */
  const accentText = (hex) => {
    const rgb = parseHex(hex);
    if (!rgb) return '#ffffff';
    const L = relLuminance(rgb);
    const contrastWhite = 1.05 / (L + 0.05);
    const contrastDark = (L + 0.05) / 0.056; // near-black ink, luminance ~0.006
    return contrastWhite >= contrastDark ? '#ffffff' : '#111418';
  };

  /** Put `css` into a <style> in the head, creating it once. */
  function styleBlock(id, css) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }

  class ThemeRegistry {
    constructor() {
      this.themes = [];
      this._structural = null;
    }

    async load() {
      try {
        this.themes = await window.csp.listThemes();
      } catch {
        this.themes = [];
      }
      return this.themes;
    }

    /** The theme with this id, else the first light theme, else the first. */
    resolve(id) {
      const list = this.themes;
      return list.find((t) => t.id === id)
        || list.find((t) => !t.dark)
        || list[0]
        || null;
    }

    /**
     * Apply a theme. `accents` is the settings accent map ({ themeId: '#rrggbb' })
     * or a single hex override for this theme. The theme's own CSS is applied last,
     * so it may override the tokens too.
     */
    apply(id, accents) {
      const theme = this.resolve(id);
      if (!theme) return;
      const manifest = (window.Iro && window.Iro.ThemeTokens) || null;
      const themeTokens = theme.tokens || {};
      const root = document.documentElement;

      const override = typeof accents === 'string'
        ? accents
        : (accents && accents[theme.id]) || '';
      const accent = HEX.test(override) ? override : themeTokens['--accent'];

      const decls = [];
      const structural = {};
      // Every manifest token is emitted: a theme's own value, else the manifest
      // default. Unknown ids the theme carries are ignored (only known tokens and
      // the local vars the stylesheet owns can reach the document).
      const decl = (key, value) => decls.push(`${key}: ${value};`);
      if (manifest) {
        for (const t of manifest.TOKENS) {
          const value = Object.prototype.hasOwnProperty.call(themeTokens, t.id) ? themeTokens[t.id] : t.default;
          decl(t.id, value);
          if (t.kind === 'structural') structural[t.id] = value;
        }
      } else {
        for (const key of Object.keys(themeTokens)) decl(key, themeTokens[key]);
      }
      if (HEX.test(override)) {
        const bg = themeTokens['--bg'] || (theme.dark ? '#1e2028' : '#ffffff');
        decl('--accent', override);
        decl('--accent-weak', mixHex(override, bg, 0.85));
      }
      if (HEX.test(accent)) decl('--accent-text', accentText(accent));

      styleBlock('theme-tokens', decls.length ? `:root { ${decls.join(' ')} }` : '');
      styleBlock('theme-css', theme.css || '');
      root.dataset.theme = theme.id;
      root.style.colorScheme = theme.dark ? 'dark' : 'light';

      // A structural change moves measured sizes; ask the window to re-measure and
      // re-clamp once (the first apply is the startup layout and needs no pass).
      const changed = this._structural !== null
        && Object.keys(structural).some((k) => this._structural[k] !== structural[k]);
      this._structural = structural;
      if (changed) {
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('theme-structural')));
      }
    }
  }

  window.Iro = window.Iro || {};
  window.Iro.ThemeRegistry = ThemeRegistry;
})();

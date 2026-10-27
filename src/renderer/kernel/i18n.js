'use strict';

// Renderer i18n: loads one locale catalog with a
// `<script>` tag (the renderer has no build step) and applies `data-i18n`
// attributes. Chrome and modules read `window.Iro.t(key, vars)`.

(function () {
  const Model = window.IroI18n;
  const loaded = new Map(); // code -> messages (null = not shipped)
  let i18n = Model.createI18n({ messages: {} });
  let current = 'en';

  /** Load one locale catalog; resolve null when it is not shipped (and remember). */
  function load(code) {
    if (loaded.has(code)) return Promise.resolve(loaded.get(code));
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `../shared/locales/${code}.js`;
      script.onload = () => {
        const messages = (window.IroLocales || {})[code] || null;
        loaded.set(code, messages);
        resolve(messages);
      };
      script.onerror = () => { loaded.set(code, null); resolve(null); };
      document.head.append(script);
    });
  }

  /** Apply translations to `[data-i18n*]` attributes under `root`. */
  function apply(root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = i18n.t(el.dataset.i18n);
    // `data-i18n-lead` translates only an element's leading text node, so a label
    // keeps a trailing hint (the `.info` tooltip) inline.
    for (const el of root.querySelectorAll('[data-i18n-lead]')) {
      const node = el.firstChild;
      if (node && node.nodeType === 3) node.nodeValue = i18n.t(el.dataset.i18nLead);
    }
    for (const el of root.querySelectorAll('[data-i18n-title]')) {
      const text = i18n.t(el.dataset.i18nTitle);
      // Where the overlay tooltip helper is loaded, a tooltip is `data-tip` (a native
      // `title` would be an OS window behind the always-on-top palettes). Elsewhere keep
      // the native attribute.
      if (window.Iro && window.Iro.tooltip) el.setAttribute('data-tip', text);
      else el.title = text;
    }
    for (const el of root.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', i18n.t(el.dataset.i18nAriaLabel));
    for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = i18n.t(el.dataset.i18nPlaceholder);
  }

  /** Switch to a locale: its catalog layered over English, which is the base. */
  async function use(code) {
    const raw = String(code || 'en');
    const base = (await load('en')) || {};
    for (const candidate of [raw, raw.split('-')[0]]) {
      if (!candidate || candidate === 'en') continue;
      const overlay = await load(candidate);
      if (overlay) {
        current = candidate;
        i18n = Model.createI18n({ messages: { ...base, ...overlay } });
        document.documentElement.lang = candidate;
        document.documentElement.dir = (window.IroLocaleNames
          ? window.IroLocaleNames.isRtl(candidate)
          : /^(ar|he)(-|$)/.test(candidate)) ? 'rtl' : 'ltr';
        apply();
        return i18n;
      }
    }
    current = 'en';
    i18n = Model.createI18n({ messages: base });
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    apply();
    return i18n;
  }

  window.Iro = window.Iro || {};
  window.Iro.i18n = {
    use,
    apply,
    load,
    /** Is a key translated in the active locale? */
    has: (key) => i18n.messages[key] != null,
    /** A module's display name, falling back to the manifest name. */
    moduleName: (id, fallback) => (i18n.messages[`module.${id}.name`] != null
      ? i18n.t(`module.${id}.name`)
      : fallback),
    get code() { return current; },
  };
  window.Iro.t = (key, vars) => i18n.t(key, vars);
})();

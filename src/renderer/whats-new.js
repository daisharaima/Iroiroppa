'use strict';

// The What's New window: the checked-in release note for the running version, shown
// once (main records `lastSeenVersion` when this window closes).

(async () => {
  const csp = window.csp;
  const $ = (id) => document.getElementById(id);

  // Follow the palette's theme and language before the first paint.
  const themeRegistry = new window.Iro.ThemeRegistry();
  await themeRegistry.load().catch(() => {});
  let settings = {};
  try {
    const snap = await csp.snapshot();
    settings = (snap && snap.settings) || {};
  } catch { /* defaults are fine */ }
  try { themeRegistry.apply(settings.theme, settings.accents || {}); } catch { /* default theme */ }
  const language = settings.language || navigator.language || 'en';
  try { await window.Iro.i18n.use(language); } catch { /* English fallback */ }

  let note = null;
  try { note = await csp.getWhatsNew(); } catch { note = null; }

  const close = async () => {
    try { await csp.markWhatsNewSeen(); } catch { /* the next launch may show it again */ }
    window.close();
  };
  $('whats-new-close').addEventListener('click', close);
  $('whats-new-done').addEventListener('click', close);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });

  if (!note) {
    $('whats-new-content').textContent = window.Iro.t('whatsNew.none');
    $('whats-new-release').classList.add('hidden');
    return;
  }

  $('whats-new-version').textContent = `v${note.version}`;
  $('whats-new-release').addEventListener('click', () => csp.openExternal(note.url).catch(() => {}));

  /** Build a safe inline run from the parser's parts. */
  const inlineNode = (parts) => {
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (part.code) {
        const code = document.createElement('code');
        code.textContent = part.text;
        frag.append(code);
      } else if (part.bold) {
        const strong = document.createElement('strong');
        strong.textContent = part.text;
        frag.append(strong);
      } else {
        frag.append(document.createTextNode(part.text));
      }
    }
    return frag;
  };

  const box = $('whats-new-content');
  let list = null;
  for (const block of window.IroReleaseNote.parse(note.markdown)) {
    if (block.type === 'bullet') {
      if (!list) {
        list = document.createElement('ul');
        box.append(list);
      }
      const item = document.createElement('li');
      item.append(inlineNode(block.parts));
      list.append(item);
      continue;
    }
    list = null;
    const el = document.createElement(block.type === 'heading' ? 'h3' : 'p');
    el.append(inlineNode(block.parts));
    box.append(el);
  }
})();

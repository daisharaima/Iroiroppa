'use strict';

// Copy / paste a module's settings (the module settings popout, docs/MODULES.md).
//
// The clipboard carries a small JSON envelope, so a paste can tell our own
// config from anything else on the clipboard. "Copy without colour model" drops
// the `model` key, so the axes transfer without dragging the source's model
// along. A paste merges over the module's current settings and rebuilds its UI.

(function () {
  const reg = (window.Iro = window.Iro || {});
  const KIND = 'iroiroppa-module-settings';

  /**
   * @param {{ root: Element, moduleId: string, get: () => object,
   *           patch: (partial: object) => void, rebuild: () => void }} opts
   */
  reg.settingsTransfer = function addSettingsTransfer(opts) {
    const csp = window.csp;
    const box = document.createElement('div');
    box.className = 'ms-transfer';

    const note = document.createElement('div');
    note.className = 'ms-note';

    const actions = document.createElement('div');
    actions.className = 'ms-transfer-actions';

    const icon = (title, svg, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-btn';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = `<svg viewBox="0 0 20 20">${svg}</svg>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(b);
      });
      return b;
    };

    const menu = document.createElement('div');
    menu.className = 'ms-menu hidden';
    const copyOption = (label, stripModel) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pop-action';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        const settings = { ...opts.get() };
        if (stripModel) delete settings.model;
        try {
          csp.copy(JSON.stringify({ kind: KIND, moduleId: opts.moduleId, settings }));
          note.textContent = window.Iro.t('ui.settings.copied');
        } catch {
          note.textContent = window.Iro.t('ui.settings.clipboardFailed');
        }
        menu.classList.add('hidden');
      });
      return btn;
    };
    menu.append(copyOption('Copy everything', false), copyOption('Copy without colour model', true));

    const copyBtn = icon(window.Iro.t('ui.settings.copy'), '<rect x="6" y="6" width="9" height="9" rx="1.5"/><path d="M10 6V4h7v7h-2"/>', () => {
      menu.classList.toggle('hidden');
    });

    const pasteBtn = icon(window.Iro.t('ui.settings.paste'), '<path d="M7 4h6v3H7z"/><path d="M6 6H4v10h9v-2"/><path d="M8 9h9v8H8z"/>', async () => {
      let env;
      try {
        env = JSON.parse(await csp.readClipboard());
      } catch {
        env = null;
      }
      if (!env || env.kind !== KIND || !env.settings || typeof env.settings !== 'object') {
        note.textContent = window.Iro.t('ui.settings.nothingToPaste');
        return;
      }
      opts.patch(env.settings);
      if (opts.rebuild) opts.rebuild();
      note.textContent = env.moduleId ? `Pasted settings from ${env.moduleId}.` : 'Pasted settings.';
    });

    actions.append(copyBtn, pasteBtn);
    if (opts.actionsHost) {
      // Inline: the caller already has the action row (module popout). The menu
      // drops below that row instead of creating a second box.
      opts.actionsHost.append(copyBtn, pasteBtn);
      actions.remove();
      (opts.menuHost || opts.root).append(menu, note);
      return;
    }
    box.append(actions, menu, note);
    opts.root.append(box);
  };
})();

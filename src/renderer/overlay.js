'use strict';

(function () {
  const csp = window.csp;
  const chip = document.getElementById('overlay-chip');
  const themeRegistry = new window.Iro.ThemeRegistry();

  document.documentElement.style.height = '100%';
  document.body.style.height = '100%';
  document.body.style.overflow = 'visible';

  const line = document.createElement('div');
  line.id = 'overlay-line';
  line.hidden = true;
  Object.assign(line.style, {
    position: 'absolute',
    zIndex: '1',
    background: 'var(--accent, #6c5ce7)',
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.35)',
    borderRadius: '1px',
    pointerEvents: 'none',
  });
  document.body.appendChild(line);

  function drawLine(spec) {
    const length = spec && Number(spec.length);
    if (!spec || !Number.isFinite(length) || length <= 0) {
      line.hidden = true;
      return;
    }
    const vertical = spec.axis === 'v';
    const thickness = 2;
    line.hidden = false;
    line.style.left = `${Math.round(spec.x - (vertical ? thickness / 2 : 0))}px`;
    line.style.top = `${Math.round(spec.y - (vertical ? 0 : thickness / 2))}px`;
    line.style.width = `${vertical ? thickness : Math.round(length)}px`;
    line.style.height = `${vertical ? Math.round(length) : thickness}px`;
  }

  const menu = document.getElementById('overlay-menu');
  const tooltip = document.getElementById('overlay-tooltip');
  const confirmEl = document.getElementById('overlay-confirm');
  const confirmTitle = document.getElementById('overlay-confirm-title');
  const confirmMessage = document.getElementById('overlay-confirm-message');
  const confirmDetail = document.getElementById('overlay-confirm-detail');
  const confirmOk = document.getElementById('overlay-confirm-ok');
  const confirmCancel = document.getElementById('overlay-confirm-cancel');

  function answerConfirm(ok) {
    if (!confirmEl || confirmEl.classList.contains('hidden')) return;
    confirmEl.classList.add('hidden');
    csp.overlayConfirmPick(ok);
  }

  /** The merge warning. The surface is already sized to this card by main. */
  function renderConfirm(spec) {
    if (!confirmEl) return;
    if (!spec) {
      confirmEl.classList.add('hidden');
      chip.style.display = '';
      return;
    }
    confirmEl.classList.remove('hidden');
    chip.style.display = 'none';
    confirmTitle.textContent = String(spec.title || '');
    confirmMessage.textContent = String(spec.message || '');
    confirmDetail.textContent = String(spec.detail || '');
    confirmDetail.classList.toggle('hidden', !spec.detail);
    confirmOk.textContent = String(spec.confirmLabel || 'OK');
    confirmCancel.textContent = String(spec.cancelLabel || 'Cancel');
    confirmOk.classList.toggle('danger', spec.danger === true);
  }

  confirmOk?.addEventListener('click', (event) => { event.stopPropagation(); answerConfirm(true); });
  confirmCancel?.addEventListener('click', (event) => { event.stopPropagation(); answerConfirm(false); });

  /** A tooltip for a page that cannot paint over the palettes (Settings, a popout). */
  function renderTooltip(spec) {
    if (!tooltip) return;
    if (!spec || !spec.text) {
      tooltip.classList.add('hidden');
      tooltip.textContent = '';
      return;
    }
    tooltip.textContent = String(spec.text);
    tooltip.classList.remove('hidden');
  }

  /**
   * The palette menu, drawn *here* because a renderer cannot paint outside its own window: main
   * shrinks this surface to exactly the menu and turns the click-through off while it is open, so
   * the menu can sit anywhere on screen and only its own clicks are taken.
   */
  function renderMenu(spec) {
    if (!menu) return;
    menu.textContent = '';
    const items = (spec && Array.isArray(spec.items)) ? spec.items : [];
    if (!items.length) {
      menu.classList.add('hidden');
      menu.classList.remove('scrolling');
      return;
    }
    items.forEach((item, index) => {
      if (item && item.kind === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'overlay-menu-sep';
        sep.setAttribute('role', 'separator');
        menu.append(sep);
        return;
      }
      if (item && item.kind === 'heading') {
        const head = document.createElement('div');
        head.className = 'overlay-menu-heading';
        head.setAttribute('role', 'presentation');
        head.textContent = item.label || '';
        menu.append(head);
        return;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = item.danger ? 'overlay-menu-item danger' : 'overlay-menu-item';
      if (item.kind === 'action') btn.classList.add('action');
      if (item.checked) btn.classList.add('checked');
      if (item.icon === 'folder') {
        const icon = document.createElement('span');
        icon.className = 'overlay-menu-icon';
        icon.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 6.5h5l1.4 1.7h8.6v7.3h-15z"/><path d="M2.5 6.5V4.5h5l1.4 1.7"/></svg>';
        btn.append(icon);
      }
      const label = document.createElement('span');
      label.className = 'overlay-menu-label';
      label.textContent = item.label;
      btn.append(label);
      btn.disabled = Boolean(item.disabled);
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        csp.overlayMenuPick(index);
      });
      menu.append(btn);
    });
    menu.classList.remove('hidden');
    menu.classList.remove('scrolling');

    menu.scrollTop = 0;

    requestAnimationFrame(() => {
      if (!menu || menu.classList.contains('hidden')) return;
      menu.classList.toggle('scrolling', menu.scrollHeight > menu.clientHeight + 2);
    });
  }

  async function init() {

    csp.onOverlay(({ text, hint, chip: chipAt, line: lineSpec } = {}) => {
      chip.textContent = text || '';
      document.body.classList.toggle('float-hint', Boolean(hint));
      if (chipAt) {
        chip.style.position = 'absolute';
        chip.style.zIndex = '2';

        chip.style.transform = 'translate(-100%, -100%)';
        chip.style.left = `${Math.round(chipAt.x)}px`;
        chip.style.top = `${Math.round(chipAt.y)}px`;
      }
      drawLine(lineSpec);
    });

    csp.onOverlayMenu(renderMenu);
    if (typeof csp.onOverlayConfirm === 'function') csp.onOverlayConfirm(renderConfirm);
    if (typeof csp.onOverlayTooltip === 'function') csp.onOverlayTooltip(renderTooltip);
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (confirmEl && !confirmEl.classList.contains('hidden')) answerConfirm(false);
      else csp.overlayMenuClose();
    });

    document.addEventListener('mousedown', (event) => {
      if (menu && !menu.classList.contains('hidden') && !event.target.closest('#overlay-menu')) {
        csp.overlayMenuClose();
      }
    });

    if (!themeRegistry) return;
    await themeRegistry.load();
    try {
      const snapshot = await csp.snapshot();
      themeRegistry.apply(snapshot.settings.theme, snapshot.settings.accents || {});
    } catch {  }
  }

  init();
})();

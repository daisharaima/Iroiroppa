'use strict';

(function () {
  const csp = window.csp;

  try { window.IroModuleManifest.register(csp.userModules()); } catch {  }
  const themeRegistry = new window.Iro.ThemeRegistry();
  const params = new URLSearchParams(location.search);
  const moduleId = params.get('moduleId') || '';
  const instanceId = params.get('instanceId') || '';

  const settingsKey = instanceId || moduleId;
  const rootEl = document.getElementById('ms-root');

  const ICONS = {
    delete: '<path d="M4 5h12M8 5V3h4v2M6 5l1 12h6l1-12"/>',
    hide: '<path d="M3 10s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><path d="M4 4l12 12"/>',
    popout: '<path d="M8 4H4v12h12v-4"/><path d="M11 3h6v6"/><path d="M17 3l-7 7"/>',
  };
  function iconAction(title, icon, onClick, { danger = false } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn ms-action';
    if (danger) btn.classList.add('danger');
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = `<svg viewBox="0 0 20 20">${icon}</svg>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(btn);
    });
    return btn;
  }

  csp.snapshot()
    .then((s) => window.Iro.i18n.use(((s && s.settings) || {}).language || navigator.language || 'en'))
    .catch(() => {  });

  let settings = {};
  const api = {
    get: () => ({ ...settings }),
    patch: (partial) => {
      Object.assign(settings, partial || {});

      const def = window.Iro.modules && window.Iro.modules[moduleId];
      csp.saveModuleSettings(settingsKey, settings, (def && def.version) || 1, moduleId).catch(() => {});
    },
  };

  function fitWindow() {
    const app = document.getElementById('app');
    if (!app) return;

    const body = document.querySelector('.ms-body');
    const prev = body ? body.style.overflow : '';
    if (body) body.style.overflow = 'visible';
    const content = Math.ceil(Math.max(
      app.offsetHeight,
      app.scrollHeight,
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    ));
    if (body) body.style.overflow = prev;
    csp.resizeModuleSettings(content);
  }

  async function loadDef(id) {
    if (window.Iro.modules && window.Iro.modules[id]) return window.Iro.modules[id];
    await new Promise((resolve) => {
      const script = document.createElement('script');
      const known = window.IroModuleManifest && window.IroModuleManifest.get(id);
      script.src = (known && known.user) ? `module://${id}/module.js` : `selector_module/${id}.js`;
      script.onload = resolve;
      script.onerror = resolve;
      document.head.append(script);
    });
    return window.Iro.modules && window.Iro.modules[id];
  }

  /** The board actions for this instance: move to a column, or pop it out. */
  async function addActions() {
    if (!instanceId) return;
    let layout = null;
    let floats = [];
    try { layout = await csp.getLayout(); } catch { layout = null; }
    try { floats = await csp.floatsList(); } catch { floats = []; }
    if (!layout) return;
    const columns = layout.columns || [];

    const inFloat = (floats || []).some((f) => (f.columns || [])
      .some((col) => (col.modules || []).some((m) => m.instanceId === instanceId)));
    const current = columns.find((col) => (col.modules || []).some((m) => m.instanceId === instanceId));

    const actions = document.createElement('div');
    actions.className = 'ms-actions';
    const iconRow = document.createElement('div');
    iconRow.className = 'ms-icon-actions';
    const note = document.createElement('div');
    note.className = 'ms-note';
    actions.append(iconRow);

    const singleton = window.Iro.modules && window.Iro.modules[moduleId]
      && window.Iro.modules[moduleId].instanceable === false;
    if (!singleton) {
      const btn = iconAction(window.Iro.t('ui.modules.delete'), ICONS.delete, async (b) => {
        if (b.dataset.armed !== '1') {
          b.dataset.armed = '1';
          b.classList.add('armed');
          b.title = window.Iro.t('ui.modules.deleteConfirm');
          b.setAttribute('aria-label', b.title);
          return;
        }
        try {
          const res = await csp.removeModule(instanceId);
          if (res && res.ok === false) {
            b.dataset.armed = '';
            b.classList.remove('armed');
            note.textContent = `Not removed: ${res.error || 'the workspace refused'}`;
            if (!note.isConnected) actions.append(note);
            return;
          }
        } catch {
          b.dataset.armed = '';
          b.classList.remove('armed');
          note.textContent = window.Iro.t('ui.modules.deleteNoAnswer');
          if (!note.isConnected) actions.append(note);
          return;
        }
        csp.closeModuleSettings();
      }, { danger: true });
      iconRow.append(btn);
    }

    if (!singleton) {
      const hideBtn = iconAction(window.Iro.t('ui.modules.disableTitle'), ICONS.hide, async () => {
        await csp.hideModule(instanceId);
        csp.closeModuleSettings();
      });
      iconRow.append(hideBtn);
    }

    const man = window.IroModuleManifest;
    const mdef = man && man.get ? man.get(moduleId) : null;
    let currentRatio = null;
    const scan = (list) => {
      for (const col of list || []) {
        for (const m of col.modules || []) if (m.instanceId === instanceId) currentRatio = m.ratio;
      }
    };
    scan(columns);
    for (const f of floats || []) scan(f.columns);
    if (currentRatio || (mdef && mdef.defaultRatio)) {
      const ratio = Number.isFinite(currentRatio) && currentRatio > 0 ? currentRatio : mdef.defaultRatio;
      const row = document.createElement('label');
      row.className = 'pop-row pop-row-range';
      const name = document.createElement('span');
      name.textContent = window.Iro.t('ui.modules.size');
      const rng = document.createElement('input');
      rng.type = 'range';
      rng.className = 'pop-range';
      rng.min = '0.05';
      rng.max = '2.5';
      rng.step = '0.01';
      rng.value = String(ratio);

      const num = document.createElement('input');
      num.type = 'number';
      num.className = 'pop-range-input';
      num.min = '0.05';
      num.max = '2.5';
      num.step = '0.01';
      num.value = ratio.toFixed(2);
      num.setAttribute('aria-label', window.Iro.t('ui.modules.size'));
      const times = document.createElement('span');
      times.className = 'pop-range-suffix';
      times.textContent = '\u00d7';
      let raf = 0;
      rng.addEventListener('input', () => {
        num.value = Number(rng.value).toFixed(2);

        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          csp.setModuleHeight(instanceId, { mode: 'ratio', ratio: Number(rng.value) });
        });
      });
      const commitNum = () => {
        const value = Number(num.value);
        if (!Number.isFinite(value)) { num.value = String(rng.value); return; }
        const clamped = Math.min(2.5, Math.max(0.05, value));
        num.value = clamped.toFixed(2);
        rng.value = String(clamped);
        csp.setModuleHeight(instanceId, { mode: 'ratio', ratio: clamped });
      };
      num.addEventListener('change', commitNum);
      num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur(); });
      row.append(name, rng, num, times);
      actions.append(row);
    }

    if (!inFloat && columns.length > 1 && current) {
      const row = document.createElement('label');
      row.className = 'pop-row pop-row-column';
      const name = document.createElement('span');
      name.textContent = window.Iro.t('ui.modules.column');
      const select = document.createElement('select');
      select.className = 'pop-select';
      columns.forEach((col, index) => {
        const option = document.createElement('option');
        option.value = col.id;
        option.textContent = `Column ${index + 1}`;
        select.append(option);
      });
      select.value = current.id;
      select.addEventListener('change', () => {
        csp.requestModuleAction({ instanceId, action: 'move', columnId: select.value });
        csp.closeModuleSettings();
      });
      row.append(name, select);
      actions.append(row);
    }

    if (!inFloat) {
      const btn = iconAction(window.Iro.t('ui.modules.popout'), ICONS.popout, () => {
        csp.requestModuleAction({ instanceId, action: 'float' });
        csp.closeModuleSettings();
      });
      iconRow.append(btn);
    }

    if (iconRow.childElementCount || actions.querySelector('.pop-row')) {
      const sep = document.createElement('div');
      sep.className = 'ms-sep';
      rootEl.append(sep, actions);
    }
    return { iconRow, actions, actionCount: iconRow.childElementCount };
  }

  async function init() {
    await themeRegistry.load();
    const snapshot = await csp.snapshot();
    try {
      await window.Iro.i18n.use(((snapshot && snapshot.settings) || {}).language || navigator.language || 'en');
    } catch {  }
    themeRegistry.apply(snapshot.settings.theme, snapshot.settings.accents || {});

    const def = await loadDef(moduleId);
    document.getElementById('ms-title').textContent = (def && def.name) || moduleId;
    const settingsStore = {
      viewFamily: window.IroColorModels
        ? window.IroColorModels.normalizeFamily((snapshot.settings || {}).viewFamily)
        : (((snapshot.settings || {}).viewFamily) || 'all'),
    };

    let stored = {};
    try { stored = (await csp.getModuleSettings(settingsKey, moduleId)) || {}; } catch { stored = {}; }
    if (def && typeof def.migrate === 'function') {
      try { stored = def.migrate(stored) || stored; } catch {  }
    }
    settings = { ...((def && def.defaults) || {}), ...stored };

    const settingsBox = document.createElement('div');
    settingsBox.className = 'ms-settings';
    rootEl.append(settingsBox);
    const mountSettings = () => {
      settingsBox.replaceChildren();
      if (def && typeof def.settingsUI === 'function') {
        try {
          def.settingsUI(api, settingsBox, settingsStore);
        } catch (err) {

          console.error('[module-settings] settingsUI failed', err);
          settingsBox.replaceChildren();
          const failed = document.createElement('div');
          failed.className = 'ms-empty';
          failed.textContent = String((err && err.message) || err || 'settings failed');
          settingsBox.append(failed);
        }
      } else {
        const empty = document.createElement('div');
        empty.className = 'ms-empty';
        empty.textContent = window.Iro.t('ui.modules.noSettings');
        settingsBox.append(empty);
      }
      requestAnimationFrame(fitWindow);
    };
    mountSettings();
    const hosts = await addActions();
    if (window.Iro.settingsTransfer && hosts) {
      window.Iro.settingsTransfer({
        root: hosts.actions,
        actionsHost: hosts.iconRow,
        menuHost: hosts.actions,
        moduleId,
        get: api.get,
        patch: api.patch,
        rebuild: mountSettings,
      });
      const divider = document.createElement('span');
      divider.className = 'ms-icon-sep';
      hosts.iconRow.insertBefore(divider, hosts.iconRow.children[hosts.actionCount] || null);
    }

    document.getElementById('ms-close').addEventListener('click', () => csp.closeModuleSettings());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') csp.closeModuleSettings(); });
    requestAnimationFrame(fitWindow);
    setTimeout(fitWindow, 60);

    if (typeof ResizeObserver === 'function') {
      const app = document.getElementById('app');
      if (app) new ResizeObserver(() => requestAnimationFrame(fitWindow)).observe(app);
    }

    if (typeof MutationObserver === 'function') {
      const body = document.querySelector('.ms-body');
      if (body) {
        let queued = false;
        new MutationObserver(() => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => { queued = false; fitWindow(); });
        }).observe(body, { childList: true, subtree: true, attributes: true });
      }
    }
  }

  init();
})();

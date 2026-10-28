'use strict';

// Selector module: CSP Shortcuts — CSP's own command/tool shortcuts and the
// app's module-command bindings, in one place. CSP's files are read-only; the
// manager can browse/invoke them and edit Iroiroppa's own bindings, and it warns
// when an app binding collides with a CSP shortcut.

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};

  function acceleratorFromEvent(e, allowBare = false) {
    const NAMED = {
      ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      Enter: 'Return', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End',
      PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', '+': 'Plus', '-': 'Minus',
      '=': 'Equal', ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote',
      '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '`': 'Backquote',
    };
    let main = NAMED[e.key];
    if (!main && /^[a-z0-9]$/i.test(e.key)) main = e.key.toUpperCase();
    if (!main && /^F([1-9]|1[0-9]|2[0-4])$/i.test(e.key)) main = e.key.toUpperCase();
    if (!main) return '';
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    if (mods.length === 0 && !allowBare && !/^F\d{1,2}$/.test(main)) return '';
    mods.push(main);
    return mods.join('+');
  }

  const norm = (accel) => (window.IroShortcutMatch
    ? window.IroShortcutMatch.normalizeAccel(accel)
    : String(accel || ''));

  reg.modules['csp-shortcuts'] = {
    id: 'csp-shortcuts',
    name: 'CSP Shortcuts',
    version: 2,
    defaults: {},
    minSize() { return { width: 150, height: 92 }; },

    create(ctx) {
      const csp = ctx.csp;
      let mode = 'csp';
      let data = { ok: false, reason: '', commands: [], tools: [], workspace: {} };
      let app = {
        commands: [],
        app: { mode: 'toggle', toggle: '', hold: '', autoDismiss: false, position: 'keep' },
        palettes: {},
        autoHide: true,
      };
      let conflicts = [];
      let kindFilter = 'all';
      let keyQuery = '';
      let capturing = false;
      let loading = false;
      let seenSavedMs = 0;

      const root = document.createElement('div');
      root.className = 'csp-shortcuts';

      const tabs = document.createElement('div');
      tabs.className = 'csp-shortcuts-tabs';
      const cspTab = document.createElement('button');
      cspTab.type = 'button';
      cspTab.className = 'csp-shortcuts-tab active';
      cspTab.textContent = 'CSP';
      const appTab = document.createElement('button');
      appTab.type = 'button';
      appTab.className = 'csp-shortcuts-tab';
      appTab.textContent = 'Iroiroppa';
      const warn = document.createElement('span');
      warn.className = 'csp-shortcuts-warn';
      tabs.append(cspTab, appTab);

      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'csp-shortcuts-search';
      search.placeholder = window.Iro.t('module.label.searchShortcuts');
      search.setAttribute('aria-label', 'Search shortcuts');

      const searchRow = document.createElement('div');
      searchRow.className = 'csp-shortcuts-searchrow';
      const recordKey = document.createElement('button');
      recordKey.type = 'button';
      recordKey.className = 'csp-shortcuts-keybtn';
      recordKey.title = 'Search by pressing a shortcut';
      recordKey.setAttribute('aria-label', 'Search by pressing a shortcut');
      recordKey.textContent = '\u2328';
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.className = 'csp-shortcuts-refresh';
      refresh.title = 'Re-read the current workspace from disk';
      refresh.setAttribute('aria-label', 'Refresh shortcuts');
      refresh.textContent = '\u21bb';
      searchRow.append(search, recordKey, refresh);

      const source = document.createElement('div');
      source.className = 'csp-shortcuts-source';
      // The clash badge shares the source line: the tabs above need the full width
      // for their equal halves.
      const meta = document.createElement('div');
      meta.className = 'csp-shortcuts-meta';
      meta.append(source, warn);

      const sourceHint = document.createElement('div');
      sourceHint.className = 'csp-shortcuts-hint hidden';

      const chips = document.createElement('div');
      chips.className = 'csp-shortcuts-chips';
      const chipDefs = [['all', 'All'], ['command', 'Command'], ['tool', 'Tool']];
      const chipEls = new Map();
      for (const [value, label] of chipDefs) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `csp-shortcuts-chip${value === 'all' ? ' active' : ''}`;
        b.textContent = label;
        b.addEventListener('click', () => {
          kindFilter = value;
          for (const [v, el] of chipEls) el.classList.toggle('active', v === value);
          render();
        });
        chipEls.set(value, b);
        chips.append(b);
      }

      const status = document.createElement('div');
      status.className = 'csp-shortcuts-empty';

      // Shown only when CSP's folder cannot be found: pick it once, globally.
      const locate = document.createElement('button');
      locate.type = 'button';
      locate.className = 'csp-shortcuts-locate hidden';
      locate.textContent = window.Iro.t('module.shortcuts.locate');
      locate.title = window.Iro.t('module.shortcuts.locateHint');
      locate.addEventListener('click', async () => {
        try {
          const picked = await csp.browseCspRoot();
          if (!picked) return;
          await csp.updateSettings({ cspDataDir: picked.path || '' });
          load();
        } catch { /* dialog cancelled */ }
      });

      const list = document.createElement('div');
      list.className = 'csp-shortcuts-list';
      root.append(tabs, chips, searchRow, meta, sourceHint, status, locate, list);
      ctx.el.append(root);

      const cspRows = () => {
        const rows = [];
        for (const c of data.commands || []) {
          rows.push({
            kind: 'command', label: c.label || c.command, accels: c.accels || (c.accel ? [c.accel] : []),
            invoke: c.accel, raw: c.raw || c.command,
          });
        }
        for (const t of data.tools || []) {
          rows.push({ kind: t.kind || 'tool', label: t.name, accels: [t.key], invoke: t.key, raw: t.name });
        }
        return rows;
      };

      const startKeySearch = () => {
        if (keyQuery) {
          keyQuery = '';
          search.placeholder = window.Iro.t('module.label.searchShortcuts');
          recordKey.classList.remove('active');
          render();
          return;
        }
        capturing = true;
        recordKey.classList.add('active');
        search.placeholder = 'Press a shortcut\u2026';
        render();
      };
      recordKey.addEventListener('click', startKeySearch);
      const onCaptureKey = (e) => {
        if (!capturing) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
          capturing = false;
          recordKey.classList.remove('active');
          search.placeholder = window.Iro.t('module.label.searchShortcuts');
          render();
          return;
        }
        const accel = acceleratorFromEvent(e, true);
        if (!accel) return;
        capturing = false;
        keyQuery = norm(accel);
        recordKey.classList.remove('active');
        search.placeholder = `Shortcut: ${accel}`;
        render();
      };
      document.addEventListener('keydown', onCaptureKey, true);

      const bindingsForConflicts = () => {
        const out = [];
        for (const c of app.commands || []) {
          out.push({ key: `${c.instanceId}:${c.command}`, label: `${c.name} · ${c.command}`, accel: c.binding || '' });
        }
        if (app.app && app.app.mode === 'toggle' && app.app.toggle) out.push({ key: 'app-toggle', label: 'Iroiroppa show/hide', accel: app.app.toggle });
        if (app.app && app.app.mode === 'hold' && app.app.hold) out.push({ key: 'app-hold', label: 'Iroiroppa hold', accel: app.app.hold });
        for (const [id, pair] of Object.entries(app.palettes || {})) {
          if (pair.mode === 'toggle' && pair.toggle) out.push({ key: `palette:${id}:toggle`, label: `${id} show/hide`, accel: pair.toggle });
          if (pair.mode === 'hold' && pair.hold) out.push({ key: `palette:${id}:hold`, label: `${id} hold`, accel: pair.hold });
        }
        return out;
      };

      const recomputeConflicts = () => {
        const match = window.IroShortcutMatch;
        conflicts = match
          ? match.findConflicts(bindingsForConflicts(), data.commands, data.tools)
          : [];
        warn.textContent = conflicts.length ? `${conflicts.length} clash with CSP` : '';
        warn.title = conflicts.map((c) => `${c.label} ↔ ${c.cspLabel}`).join('\n');
      };

      const recordBinding = async (entry, input) => {
        const clear = (e) => e.key === 'Escape';
        input.addEventListener('keydown', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const accel = clear(e) ? '' : acceleratorFromEvent(e);
          if (!clear(e) && !accel) return;
          let res;
          try {
            res = entry.summon
              ? await csp.setShortcut({ target: 'app', action: 'toggle', accel })
              : await csp.setCommandBinding(entry.key, accel);
          } catch {
            res = { ok: false };
          }
          if (res && res.ok) {
            input.value = accel;
            input.classList.remove('invalid');
            if (entry.summon) app.app.toggle = accel;
            else {
              const target = app.commands.find((c) => `${c.instanceId}:${c.command}` === entry.key);
              if (target) target.binding = accel;
            }
            recomputeConflicts();
            render();
          } else {
            input.classList.add('invalid');
            input.title = window.Iro.t('settings.commands.taken');
          }
        });
      };

      const render = () => {
        cspTab.classList.toggle('active', mode === 'csp');
        appTab.classList.toggle('active', mode === 'app');
        chips.classList.toggle('hidden', mode === 'app');
        locate.classList.toggle('hidden', mode === 'app' || data.ok);
        const q = search.value.trim().toLowerCase();
        list.textContent = '';
        status.textContent = '';
        status.classList.toggle('hidden', true);

        if (mode === 'csp') {
          if (!data.ok) {
            status.textContent = data.reason || 'CSP settings not found';
            status.classList.remove('hidden');
            if (data.settings) status.title = data.settings;
          }
          const shown = cspRows().filter((r) => {
            if (kindFilter === 'command' && r.kind !== 'command') return false;
            if (kindFilter === 'tool' && r.kind === 'command') return false;
            if (keyQuery && !r.accels.some((a) => norm(a) === keyQuery)) return false;
            return !q || r.label.toLowerCase().includes(q)
              || r.accels.some((a) => String(a).toLowerCase().includes(q))
              || String(r.raw || '').toLowerCase().includes(q);
          });
          for (const r of shown.slice(0, 300)) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `csp-shortcut-row${r.kind === 'tool' ? ' tool' : ''}`;
            row.title = r.raw && r.raw !== r.label ? r.raw : '';
            const name = document.createElement('span');
            name.className = 'csp-shortcut-name';
            name.textContent = r.label;
            const accel = document.createElement('span');
            accel.className = 'csp-shortcut-accel';
            accel.textContent = r.accels.length ? r.accels.join(', ') : '\u2014';
            row.append(name, accel);
            if (r.invoke) row.addEventListener('click', () => csp.cspInvoke({ accel: r.invoke }));
            else row.disabled = true;
            list.append(row);
          }
          if (!shown.length) {
            status.textContent = keyQuery
              ? 'No shortcut bound to that key'
              : ((data.commands || []).length || (data.tools || []).length ? 'no match' : (data.reason || 'no shortcuts found'));
            status.classList.remove('hidden');
          } else if (kindFilter === 'tool' && !(data.tools || []).length) {
            status.textContent = 'no tool shortcuts found';
            status.classList.remove('hidden');
          }
          return;
        }

        const appRows = [];
        if (app.app && app.app.mode === 'toggle' && app.app.toggle) {
          appRows.push({ template: 'summon', label: window.Iro.t('settings.shortcuts.showAll'), accel: app.app.toggle });
        }
        for (const c of app.commands || []) {
          appRows.push({
            template: 'command',
            key: `${c.instanceId}:${c.command}`,
            label: `${c.name} · ${c.command}${c.hidden ? ' (hidden)' : ''}`,
            accel: c.binding || '',
            hidden: c.hidden,
          });
        }
        const shown = appRows.filter((r) => (!keyQuery || norm(r.accel) === keyQuery)
          && (!q || r.label.toLowerCase().includes(q) || String(r.accel || '').toLowerCase().includes(q)));
        for (const r of shown) {
          const row = document.createElement('div');
          row.className = 'csp-shortcut-row app';
          const name = document.createElement('span');
          name.className = 'csp-shortcut-name';
          name.textContent = r.label;
          const input = document.createElement('input');
          input.className = 'csp-shortcut-binding';
          input.readOnly = true;
          input.spellcheck = false;
          input.placeholder = window.Iro.t('settings.commands.none');
          input.value = r.accel || '';
          input.title = window.Iro.t('settings.commands.recordHint');
          input.setAttribute('aria-label', `${r.label} shortcut`);
          const entry = r.template === 'summon'
            ? { summon: true }
            : { key: r.key };
          recordBinding(entry, input);
          row.append(name, input);
          list.append(row);
        }
        if (!shown.length) {
          status.textContent = window.Iro.t('settings.commands.empty');
          status.classList.remove('hidden');
        }
      };

      cspTab.addEventListener('click', () => { mode = 'csp'; render(); });
      appTab.addEventListener('click', () => { mode = 'app'; render(); });
      search.addEventListener('input', render);

      const describeSource = () => {
        const ws = data.workspace || {};
        if (!ws.path) {
          source.textContent = 'No current workspace file';
          source.title = '';
          return;
        }
        const when = ws.savedAt
          ? new Date(ws.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
          : 'unknown';
        source.textContent = `${ws.file || 'workspace'} \u00b7 saved ${when}`;
        source.title = ws.path;
      };

      const load = async ({ initial = false } = {}) => {
        if (loading) return;
        loading = true;
        refresh.disabled = true;
        try {
          const [cspData, appData] = await Promise.all([
            csp.cspShortcuts().catch(() => ({ ok: false, reason: 'CSP settings unavailable', commands: [], tools: [] })),
            csp.shortcutCatalog().catch(() => ({ commands: [], summonHotkey: '' })),
          ]);
          data = cspData || data;
          app = Array.isArray(appData)
            ? {
              commands: appData,
              app: { mode: 'toggle', toggle: '', hold: '', autoDismiss: false, position: 'keep' },
              palettes: {},
              autoHide: true,
            }
            : {
              commands: (appData && appData.commands) || [],
              app: (appData && appData.app) || {
                mode: 'toggle',
                toggle: (appData && appData.summonHotkey) || '',
                hold: '',
                autoDismiss: false,
                position: 'keep',
              },
              palettes: (appData && appData.palettes) || {},
              autoHide: !appData || appData.autoHide !== false,
            };
          const saved = Number((data.workspace || {}).savedMs) || 0;
          const unchanged = Boolean(initial === false && saved && seenSavedMs && saved === seenSavedMs);
          seenSavedMs = saved || seenSavedMs;
          describeSource();
          sourceHint.classList.toggle('hidden', !unchanged);
          if (unchanged) {
            sourceHint.textContent = 'CSP has not written this workspace yet \u2014 save the workspace or close CSP, then Refresh.';
          }
          recomputeConflicts();
          render();
        } finally {
          loading = false;
          refresh.disabled = false;
        }
      };
      refresh.addEventListener('click', () => load());
      load({ initial: true });

      return {
        destroy() { document.removeEventListener('keydown', onCaptureKey, true); },
      };
    },
  };
})();

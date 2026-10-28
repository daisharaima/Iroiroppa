'use strict';

// Selector module: Session — Iroiroppa's own control panel, and the only *singleton* module
// (`module-manifest.js` marks `session` `instanceable: false`, so the reducer refuses a second
// instance). It is **one row** and it never gets taller (docs/LAYOUT.md, "One palette"):
//
//     ●  Clip Studio Paint            [◐] [🔒] [⚙]
//
// - The **dot** is the connection state *and* the action: green while connected, and a click pairs
//   when it is idle or failed. There are no connect/scan buttons — the app connects by itself — and
//   Disconnect lives in this module's own ⋯ panel (and in the tray).
// - The **profile dropdown** shows the document's current colour profile and opens the
//   switcher: the same pinned default row plus list of profiles the Settings window
//   shows (`.profile-pinned` / `.profile-item`), so the two cannot drift apart.
// - The **lock** is the layout lock (it is also a Settings row and a hamburger entry).
// - The **gear** opens Settings, and is rightmost — it is the window's own icon-button style, so it
//   matches every other icon button in the app.
//   The row carries only a *faint* accent wash: a solid tint plus a bar read like an admonition box.
//
// Nothing here is owned by the module. The connection, the profile and the settings are main-owned
// broadcasts (`companion:status`, `settings:changed`), so every palette that mounts this module shows
// exactly the same thing.

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};

  const CONNECTED_STATES = new Set(['live', 'connected', 'paired']);
  // Not connected: the dot's tooltip carries the state; the row itself shows the
  // current document profile.
  const STATE_KEYS = {
    idle: 'module.session.state.idle',
    disconnected: 'module.session.state.disconnected',
    scanning: 'module.session.state.scanning',
    connecting: 'module.session.state.connecting',
    authenticating: 'module.session.state.authenticating',
    reconnecting: 'module.session.state.reconnecting',
    pairFailed: 'module.session.state.pairFailed',
    error: 'module.session.state.pairFailed',
  };
  const STATE_TEXT = {
    idle: 'Disconnected',
    disconnected: 'Disconnected',
    scanning: 'Scanning…',
    connecting: 'Connecting…',
    authenticating: 'Connecting…',
    reconnecting: 'Reconnecting…',
    pairFailed: 'Pairing failed',
    error: 'Pairing failed',
  };
  /** Translate, falling back to the English literal while the catalog is loading. */
  const tr = (key, fallback) => {
    const t = window.Iro && window.Iro.t;
    if (typeof t !== 'function') return fallback;
    const value = t(key);
    return value === key ? fallback : value;
  };
  const stateLabel = (state) => tr(STATE_KEYS[state] || STATE_KEYS.idle, STATE_TEXT[state] || STATE_TEXT.idle);
  // One subscription per *window*, shared by every mount of this module: the host mounts a module
  // again whenever the board rebuilds, and `ipcRenderer.on` listeners are never removed by
  // discarding the DOM — a few rebuilds and the renderer reports eleven `companion:status`
  // listeners. `status` and `settings` live here so a fresh mount starts from what was last seen.
  const shared = {
    wired: false,
    status: 'idle',
    settings: {},
    rerenders: new Set(),
    settingsRefresh: new Set(),
    // One IPC listener per window; every mounted session row dispatches through this set.
    profileHandlers: new Set(),
  };

  const settingsUI = (api, root) => {
    const note = document.createElement('div');
    note.className = 'pop-note';
    note.textContent = window.Iro.t('module.session.note');
    root.append(note);

    // Disconnect is deliberately not in the one-line row: a mis-click there would drop the session
    // mid-drawing. It lives here, and in the tray menu.
    const row = document.createElement('div');
    row.className = 'pop-row';
    const off = document.createElement('button');
    off.type = 'button';
    off.className = 'btn';
    off.textContent = window.Iro.t('module.session.disconnect');
    off.addEventListener('click', () => { window.csp.disconnect(); });
    row.append(off);
    root.append(row);
  };

  reg.modules['session'] = {
    id: 'session',
    name: 'Session',
    version: 1,
    defaults: {},
    autoHeight: true,
    // It keeps its own height even alone in a column (`rigid`), so stretching can never make it two
    // rows. It is *not* headless: the card head carries the module's name and the ⋯ menu — but it is
    // `compact`, so that head is drawn *over* the row rather than above it: a header-only card.
    rigid: true,
    compact: true,
    settingsUI,
    // Exactly one row: dot, the profile dropdown, the lock and the gear. The width
    // is the minimum those controls need; the dropdown ellipsises when it is wider.
    minSize() { return { width: 156, height: 32 }; },

    create(ctx) {
      const root = document.createElement('div');
      root.className = 'session session-row';
      // This mount's subscriptions, so `destroy()` can take them out again.
      let statusCb = null;
      let settingsCb = null;

      // The dot is the state and the action: green while connected, a click pairs when idle.
      // Its tooltip is the only place "Clip Studio Paint" appears now.
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'dot';
      // The document's colour profile, as a dropdown in the row. The list is drawn by
      // the overlay; this button just shows the current profile.
      const profile = document.createElement('button');
      profile.type = 'button';
      profile.className = 'session-profile';
      profile.setAttribute('aria-haspopup', 'listbox');
      const profileName = document.createElement('span');
      profileName.className = 'session-profile-name';
      profileName.textContent = window.Iro.t('module.session.defaultProfile');
      const chevron = document.createElement('span');
      chevron.className = 'session-profile-chevron';
      chevron.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5l3-3"/></svg>';
      profile.append(profileName, chevron);
      const lock = document.createElement('button');
      lock.type = 'button';
      lock.className = 'icon-btn session-lock';
      lock.title = window.Iro.t('module.session.lockTitle');
      lock.setAttribute('aria-label', 'Lock the layout');
      lock.innerHTML = '<svg viewBox="0 0 20 20"><rect x="5" y="9" width="10" height="7" rx="1.6"/><path d="M7.4 9V7.2a2.6 2.6 0 0 1 5.2 0V9"/></svg>';
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.className = 'icon-btn session-settings';
      settings.title = window.Iro.t('module.session.settingsTitle');
      settings.setAttribute('aria-label', 'Settings');
      // A symmetric gear: a ring, a hub and eight teeth (the first one read as a
      // lopsided sun). Drawn with the session row's stroke style.
      settings.innerHTML = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="4.2"/><circle cx="10" cy="10" r="1.5"/><path d="M10 5.8V3.2M10 14.2v2.6M5.8 10H3.2M14.2 10h2.6M7.03 7.03L5.19 5.19M12.97 12.97l1.84 1.84M12.97 7.03l1.84-1.84M7.03 12.97l-1.84 1.84"/></svg>';

      root.append(dot, profile, lock, settings);
      ctx.el.append(root);

      let status = 'idle';
      let current = Object.assign({}, ctx.settings || {});
      const profileNames = new Map();
      const connected = () => CONNECTED_STATES.has(status);

      /** A file name without its ICC extension, for a profile the scan did not describe. */
      const basenameOf = (path) => String(path || '').split(/[\\/]/).pop()
        .replace(/\.(icc|icm)$/i, '') || String(path || '');

      /** The name shown in the row: the default entry, or the profile's own description. */
      const profileLabel = () => {
        const path = current.proofMode === 'default' ? '' : (current.proofProfile || '');
        if (!path) return tr('module.session.defaultProfile', 'Default sRGB');
        return profileNames.get(path) || basenameOf(path);
      };

      const render = () => {
        const isConnected = connected();
        const state = stateLabel(status);
        const action = status === 'scanning'
          ? tr('module.session.clickStop', 'click to stop')
          : status === 'pairFailed' || status === 'error'
            ? tr('module.session.clickRetry', 'click to retry')
            : tr('module.session.clickConnect', 'click to connect');
        const tip = isConnected
          ? tr('module.session.connectedTip', 'Connected to Clip Studio Paint')
          : `${state} — ${action}`;
        // The dot's colour *is* the state (the classes the stylesheet already carries).
        dot.classList.toggle('online', isConnected);
        dot.classList.toggle('busy', status === 'scanning' || status === 'connecting'
          || status === 'authenticating' || status === 'reconnecting');
        dot.classList.toggle('error', status === 'pairFailed' || status === 'error');
        dot.setAttribute('data-tip', tip);
        dot.setAttribute('aria-label', tip);
        root.dataset.state = status;
        const path = current.proofMode === 'default' ? '' : (current.proofProfile || '');
        profile.dataset.profile = path;
        profileName.textContent = profileLabel();
        profile.setAttribute('aria-label', `${tr('module.session.proofTitle', 'Color profile of the document')}: ${profileLabel()}`);
        profile.setAttribute('data-tip', path
          ? `${profileLabel()} — ${tr('module.session.profileHint', 'click to change the color profile')}`
          : tr('module.session.profileHint', 'click to change the color profile'));
        lock.classList.toggle('active', current.locked === true);
        lock.title = tr('module.session.lockTitle', current.locked === true
          ? 'Layout locked — click to unlock' : 'Lock the layout');
      };

      dot.addEventListener('click', () => {
        // Connected: do nothing (dropping the connection is the ⋯ panel's job).
        // Scanning: the dot is the only stop button the row has. Otherwise ask to pair.
        if (connected()) return;
        if (status === 'scanning') { window.csp.cancelScan().catch(() => {}); return; }
        window.csp.pair().catch(() => { /* surfaced through status */ });
      });
      settings.addEventListener('click', () => window.csp.openSettings());
      lock.addEventListener('click', () => {
        const next = current.locked !== true;
        current = Object.assign({}, current, { locked: next });
        render();
        window.csp.updateSettings({ locked: next });
      });

      /* --- the profile dropdown (the row's main control) --------------------------------- */

      const shortProfileName = (path) => String(path || '').split(/[\\/]/).pop() || String(path || '');
      let pickEntries = [];

      const choose = (path) => {
        // The palette's old picker turned proofing on when a profile was chosen; keep that rule
        // where the control moved to (docs/LAYOUT.md, "One palette").
        current = Object.assign({}, current, { proofProfile: path, proofMode: path ? 'proof' : 'default' });
        if (path && !profileNames.has(path)) profileNames.set(path, basenameOf(path));
        render();
        window.csp.updateSettings({ proofProfile: path, proofMode: path ? 'proof' : 'default' });
      };

      /** Browse for an ICC file. `proof:browse` resolves to a path string (or null). */
      const browseProfile = async () => {
        try {
          const picked = await window.csp.browseProofProfile();
          const path = typeof picked === 'string' ? picked : (picked && picked.path);
          if (path) choose(path);
        } catch { /* the dialog or the read failed; leave the profile alone */ }
      };

      /**
       * The picker is drawn by the overlay window, exactly like the palette's ☰ menu: an
       * in-card popup is clipped by the column's `overflow: hidden` and can never leave the
       * palette's bounds (the user's report). The overlay can.
       */
      const openProfilePicker = async () => {
        let list = [];
        // A *fresh* scan, so a profile the user just added in Settings appears here without a
        // restart; asking for the cached list is what hid the rest of their ICC profiles.
        try {
          const out = await window.csp.listProofProfiles(true);
          list = Array.isArray(out) ? out : (out && (out.profiles || out.items)) || [];
        } catch { list = []; }
        pickEntries = list.map((entry) => (typeof entry === 'string'
          ? { path: entry, name: shortProfileName(entry) }
          : { path: entry.path || '', name: entry.description || entry.name || shortProfileName(entry.path) }));
        profileNames.clear();
        for (const entry of pickEntries) if (entry.path) profileNames.set(entry.path, entry.name);
        const wanted = await currentProfilePath();
        // The document's profile is listed even when the scan does not carry it (applied by a
        // flag, or the file has moved): a missing row would read as "sRGB".
        if (wanted && !pickEntries.some((e) => e.path === wanted)) {
          pickEntries.unshift({ path: wanted, name: shortProfileName(wanted), extra: true });
        }
        const items = [
          // A command, not a radio row: the folder icon and action styling keep it
          // from reading as one more profile.
          { id: 'browse', label: tr('settings.profile.browse', 'Browse for ICC profile…'), kind: 'action', icon: 'folder' },
          { kind: 'separator' },
          { id: 'default', label: tr('settings.profile.default', 'Default sRGB (no custom profile)'), checked: !current.proofProfile },
          ...pickEntries.map((entry, i) => ({ id: `p${i}`, label: entry.name, checked: entry.path === wanted })),
        ];
        const r = profile.getBoundingClientRect();
        const width = 236;
        const spec = {
          items,
          width,
          anchor: {
            x: Math.round(window.screenX + r.right - width),
            y: Math.round(window.screenY + r.bottom + 2),
          },
        };
        if (window.Iro && window.Iro.overlayMenu) {
          window.Iro.overlayMenu.show('profile', profile, spec);
          return;
        }
        // No overlay available (an old page): keep the old in-window fallback minimal.
        window.csp.showPaletteMenu?.({ ...spec, menu: 'profile' });
      };

      profile.addEventListener('click', () => { openProfilePicker(); });

      const onProfilePick = (pick) => {
        if (!pick || pick.menu !== 'profile') return;
        if (pick.id === 'default') { choose(''); return; }
        if (pick.id === 'browse') { browseProfile(); return; }
        const index = /^p(\d+)$/.exec(pick.id || '');
        if (!index) return;
        const entry = pickEntries[Number(index[1])];
        if (entry) choose(entry.path);
      };

      /** Put the document's profile on the dropdown, falling back to what main reports. */
      const syncProfileValue = async () => {
        const path = await currentProfilePath();
        if (path) current = Object.assign({}, current, { proofProfile: path });
        await refreshProfileNames();
        render();
      };
      const currentProfilePath = async () => {
        if (current.proofProfile) return current.proofProfile;
        try {
          const info = await window.csp.getProof();
          if (info && info.ok) {
            const path = info.path || (info.profile && (info.profile.path || info.profile.description));
            if (path) return path;
          }
        } catch { /* leave it unset */ }
        return '';
      };

      /* --- the label ------------------------------------------------------------- */

      /** Populate the profile-name map once, so the row can show a description. */
      const refreshProfileNames = async () => {
        try {
          const out = await window.csp.listProofProfiles(false);
          const list = Array.isArray(out) ? out : [];
          for (const entry of list) {
            if (typeof entry === 'string') profileNames.set(entry, shortProfileName(entry));
            else if (entry && entry.path) {
              profileNames.set(entry.path, entry.description || entry.name || shortProfileName(entry.path));
            }
          }
        } catch { /* the basename fallback is fine */ }
      };

      // Subscribe once per *window*, not per mount: the host mounts a module again whenever the
      // board re-renders, and these are `ipcRenderer.on` listeners that nothing removes — a few
      // re-renders and the renderer reports "MaxListenersExceededWarning: 11 companion:status
      // listeners". `state` is shared, so a later mount reads what the first subscription set.
      if (!shared.wired) {
        shared.wired = true;
        window.csp.onStatus((s) => {
          shared.status = (s && s.state) || 'idle';
          for (const rerender of shared.rerenders) rerender(shared.status);
        });
        window.csp.onSettings((s) => {
          Object.assign(shared.settings, s || {});
          for (const refresh of shared.settingsRefresh) refresh();
        });
        if (typeof window.csp.onPaletteMenuPick === 'function') {
          window.csp.onPaletteMenuPick((pick) => {
            for (const fn of shared.profileHandlers) {
              try { fn(pick); } catch { /* one bad row must not break the others */ }
            }
          });
        }
      }
      // This mount's own callbacks, removed again in `destroy()` (the host calls it before it
      // mounts anything in a rebuild).
      const onStatus = (next) => { status = next; render(); };
      const onSettings = () => { current = Object.assign({}, shared.settings); syncProfileValue(); };
      shared.rerenders.add(onStatus);
      shared.settingsRefresh.add(onSettings);
      shared.profileHandlers.add(onProfilePick);
      statusCb = onStatus;
      settingsCb = onSettings;
      status = shared.status;
      current = Object.assign({}, shared.settings);

      // A card can mount *after* the pushes that carry the state (opening a float, or a card
      // added later), so ask once — the same reason `palette:state:get` exists. Without this the
      // card sat on "Not connected" in a connected app, which the regenerated screenshot showed.
      window.csp.snapshot().then((snap) => {
        if (!snap) return;
        const st = snap.state || snap.status;
        // Either shape reaches here: the status *object* (`{ state, detail, remote }`, what the
        // broadcast sends) or a bare state string. Reading it wrong printed "[object Object]".
        if (st && typeof st === 'object') status = st.state || status;
        else if (typeof st === 'string') status = st;
        current = Object.assign({}, current, snap.settings || {});
        render();
        syncProfileValue();
      }).catch(() => { /* the pushes will catch up */ });

      render();
      syncProfileValue();

      return {
        onSettings(next) {
          current = Object.assign({}, next || {});
          render();
        },
        settings(rootEl) { settingsUI(ctx.settings, rootEl); },
        destroy() {
          // Take this mount's callbacks out; the IPC subscription itself belongs to the window and
          // is made once (`shared.wired`).
          if (statusCb) shared.rerenders.delete(statusCb);
          if (settingsCb) shared.settingsRefresh.delete(settingsCb);
          shared.profileHandlers.delete(onProfilePick);
          statusCb = null;
          settingsCb = null;
        },
      };
    },
  };
})();

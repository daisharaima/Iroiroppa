'use strict';

(function () {
  const SETTINGS_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.7"/><circle cx="10" cy="10" r="1.7"/><circle cx="16" cy="10" r="1.7"/></svg>';
  const MINIMIZE_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg>';

  const LENS_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.4"/><path d="M13 13l3.4 3.4"/><path d="M6 9h6M6.8 6.7h4.4M6.8 11.3h4.4"/></svg>';
  const DOCK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v8"/><path d="M6.5 8.5 10 12l3.5-3.5"/><path d="M4 15.5h12"/></svg>';

  const EYE_OPEN = '<svg class="float-eye-open" viewBox="0 0 20 20" aria-hidden="true"><path d="M1.8 10S4.8 4.8 10 4.8 18.2 10 18.2 10 15.2 15.2 10 15.2 1.8 10 1.8 10Z"/><circle cx="10" cy="10" r="2.6"/></svg>';
  const EYE_CLOSED = '<svg class="float-eye-closed" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 10S5.5 5 10 5c1.4 0 2.6.4 3.7 1"/><path d="M13.6 13.7C12.6 14.5 11.4 15 10 15c-4.5 0-7.5-5-7.5-5a16 16 0 0 1 2.4-2.6"/><path d="M3.5 3.5l13 13"/></svg>';

  class ModuleHost {
    constructor({ root, color, csp, capabilities }) {
      this.root = root;
      this.color = color;
      this.csp = csp;
      this.capabilities = capabilities || null;
      this.mounted = [];
      this._loaded = new Set();
      this._saveTimers = new Map();
    }

    /** Load the module files that are not in the document yet. */
    load(ids) {
      const fresh = ids.filter((id) => !this._loaded.has(id));
      return Promise.all(fresh.map((id) => new Promise((resolve, reject) => {
        const script = document.createElement('script');

        const known = window.IroModuleManifest && window.IroModuleManifest.get(id);
        script.src = (known && known.user) ? `module://${id}/module.js` : `selector_module/${id}.js`;
        script.async = false;
        script.onload = () => { this._loaded.add(id); resolve(); };
        script.onerror = () => reject(new Error(`could not load selector module "${id}"`));
        document.head.append(script);
      })));
    }

    /** Mount a module, merging its stored settings over its defaults. */
    async mount(id, parent, instanceId, options = {}) {
      const def = window.Iro.modules && window.Iro.modules[id];
      if (!def) throw new Error(`selector module "${id}" did not register`);

      const displayName = (window.Iro && window.Iro.i18n)
        ? window.Iro.i18n.moduleName(id, def.name || id)
        : (def.name || id);

      let stored = {};

      const settingsKey = options.settingsKey || instanceId || id;

      if (options.settings && typeof options.settings === 'object') {
        stored = { ...options.settings };
      } else {
        try { stored = (await this.csp.getModuleSettings(settingsKey, id)) || {}; } catch { stored = {}; }
        if (typeof def.migrate === 'function') {
          try { stored = def.migrate(stored) || stored; } catch {  }
        }
      }
      const settings = { ...(def.defaults || {}), ...stored };

      const el = document.createElement('section');
      el.className = 'module';
      el.dataset.module = id;
      if (instanceId) el.dataset.instance = instanceId;
      el.dataset.name = displayName;
      if (options.float) el.classList.add('float-module');

      if (options.compact) el.classList.add('module-compact');

      let lensParts = null;
      let head = null;
      if (!options.headless) {
        head = document.createElement('header');
        head.className = 'module-head';
        const title = document.createElement('span');
        title.className = 'module-title';
        title.textContent = displayName;
        const settingsBtn = document.createElement('button');
        settingsBtn.type = 'button';
        settingsBtn.className = 'module-settings';
        settingsBtn.title = window.Iro.t('ui.module.settingsTitle');
        settingsBtn.setAttribute('aria-label', `${displayName} settings`);
        settingsBtn.innerHTML = SETTINGS_ICON;

        head.append(title, settingsBtn);

        if (!options.compact && !options.headless) {
          const minBtn = document.createElement('button');
          minBtn.type = 'button';
          minBtn.className = 'module-collapse';
          minBtn.title = window.Iro.t('ui.module.collapse');
          minBtn.setAttribute('aria-label', window.Iro.t('ui.module.collapse'));
          minBtn.setAttribute('aria-expanded', 'true');
          minBtn.innerHTML = MINIMIZE_ICON;
          head.insertBefore(minBtn, settingsBtn);
        }

        if (def && def.lens) {
          const lensBtn = document.createElement('button');
          lensBtn.type = 'button';
          lensBtn.className = 'module-lens';
          lensBtn.title = window.Iro.t('ui.module.lens');
          lensBtn.setAttribute('aria-label', `${displayName} — ${window.Iro.t('ui.module.lens')}`);
          lensBtn.innerHTML = LENS_ICON;
          const label = document.createElement('span');
          label.className = 'module-lens-label';
          lensBtn.append(label);
          const anchor = head.querySelector('.module-collapse');
          if (anchor) head.insertBefore(lensBtn, anchor); else head.insertBefore(lensBtn, settingsBtn);
          lensParts = { btn: lensBtn, label };
        }
      }

      const body = document.createElement('div');
      body.className = 'module-body';

      if (head) el.append(head, body); else el.append(body);
      (parent || this.root).append(el);

      const avail = this.capabilities
        ? this.capabilities.availability(def)
        : { ok: true, unavailable: '' };
      if (!avail.ok) {
        el.classList.add('module-unavailable');
        const notice = document.createElement('div');
        notice.className = 'module-unavailable-notice';
        notice.textContent = avail.unavailable;
        body.append(notice);
        const record = { id, el, def, settings, instanceId, instance: null, unavailable: true };
        this.mounted.push(record);
        return record;
      }

      if (lensParts && settings.lens) this._paintLens(lensParts, settings.lens);

      const record = { id, el, def, settings, instanceId };
      if (lensParts) record.lens = lensParts;
      this.mounted.push(record);

      const ctx = {
        el: body,
        id,
        color: this.color,
        csp: this.csp,
        instanceId: instanceId || id,
        capabilities: this.capabilities,
        settings: {
          get: () => ({ ...settings }),
          patch: (partial) => {
            Object.assign(settings, partial || {});
            if (record.instance && record.instance.onSettings) record.instance.onSettings({ ...settings });
            this._scheduleSave(settingsKey, settings, def.version, def.id || def.moduleId);
          },
        },
        log: (...args) => console.log(`[${id}]`, ...args),

        requestLayout: () => this._scheduleLayout(),
      };
      record.ctx = ctx;

      record.instance = (def.create && def.create(ctx)) || {};
      this._registerCommands(record);

      if (typeof ResizeObserver === 'function') {
        record.ro = new ResizeObserver(() => {
          if (record.instance.onResize) {
            record.instance.onResize({ width: body.clientWidth, height: body.clientHeight });
          }
        });
        record.ro.observe(el);
      }
      requestAnimationFrame(() => {
        if (record.instance.onResize) {
          record.instance.onResize({ width: body.clientWidth, height: body.clientHeight });
        }
      });
      if (record.instance.onSettings) record.instance.onSettings({ ...settings });
      return record;
    }

    /**
     * Forget the mounted records (used when the board rebuilds from a layout). Release what each
     * instance holds *first*: a module may subscribe to the colour store or to IPC, and throwing
     * the DOM away does not undo any of that. Skipping it is how a renderer ended up reporting
     * "MaxListenersExceededWarning: 11 companion:status listeners" after a few re-renders.
     */
    reset() {
      for (const record of this.mounted) {
        try { if (record.instance && record.instance.destroy) record.instance.destroy(); } catch {  }
        try { if (record.ro) record.ro.disconnect(); } catch {  }
        try {
          if (record.instanceId && window.Iro && window.Iro.commands) {
            window.Iro.commands.unregisterLocal(record.instanceId);
          }
        } catch {  }
      }
      this.mounted = [];
    }

    /**
     * Expose a module's commands on the kernel command bus (docs/MODULES.md).
     * Commands come from `create(ctx)`'s returned object (they close over the
     * instance) or, for stateless ones, the def's own `commands`. An instance
     * command is called with its arguments; a def-level command is called with
     * `(ctx, ...args)`. A window without the bus (the Settings preview) simply
     * skips this.
     */
    _registerCommands(record) {
      const bus = window.Iro && window.Iro.commands;
      if (!bus || !record.instanceId) return;
      const fromInstance = (record.instance && record.instance.commands) || null;
      const fromDef = (record.def && record.def.commands) || null;
      if (!fromInstance && !fromDef) return;
      const table = {};
      if (fromInstance) {
        for (const [name, fn] of Object.entries(fromInstance)) {
          if (typeof fn === 'function') table[name] = (...args) => fn.apply(record.instance, args);
        }
      }
      if (fromDef) {
        for (const [name, fn] of Object.entries(fromDef)) {
          if (typeof fn === 'function' && !table[name]) table[name] = (...args) => fn.call(null, record.ctx, ...args);
        }
      }
      bus.registerLocal(record.instanceId, table);
    }

    /**
     * Release one record: the same cleanup `reset()` does, for a mount whose board pass lost the
     * column while the mount was awaiting (see `kernel/layout.js#_syncColumn`). Without it the
     * orphaned instance would keep its store and IPC subscriptions and its command registrations,
     * and would never be mounted again for its instance id.
     */
    drop(record) {
      if (!record) return;
      try { if (record.instance && record.instance.destroy) record.instance.destroy(); } catch {  }
      try { if (record.ro) record.ro.disconnect(); } catch {  }
      try {
        if (record.instanceId && window.Iro && window.Iro.commands) {
          window.Iro.commands.unregisterLocal(record.instanceId);
        }
      } catch {  }
      const i = this.mounted.indexOf(record);
      if (i >= 0) this.mounted.splice(i, 1);
    }

    /** A mounted instance's current settings (for min-size lookups). */
    settingsFor(instanceId) {
      const record = this.mounted.find((r) => r.instanceId === instanceId);
      return record ? { ...record.settings } : {};
    }

    /** The mounted record for an instance id (its instance + settings). */
    recordFor(instanceId) {
      return this.mounted.find((r) => r.instanceId === instanceId) || null;
    }

    /** Change one mounted instance's settings (used by the board's size drags). */
    patchSettings(instanceId, partial) {
      const record = this.recordFor(instanceId);
      if (!record || !record.ctx || !partial) return;
      record.ctx.settings.patch(partial);
    }

    /**
     * The lenses of one instance, as its card shows them: the button tinted with a dot and
     * a short label (`Quantize · 3/3/3`). An inert lens (all 8 bits) reads as off, because
     * it changes nothing (see the lens requirement, §2).
     */
    _paintLens(parts, lens) {
      if (!parts || !parts.btn) return;
      const active = Boolean(lens && lens.active === 'quantize');
      const bits = (lens && lens.quantize && Array.isArray(lens.quantize.bits))
        ? lens.quantize.bits.join('/')
        : '';
      const inert = active && bits && bits.split('/').every((b) => Number(b) === 8);
      const on = active && !inert;
      parts.btn.classList.toggle('on', on);
      parts.btn.dataset.active = on ? '1' : '0';
      parts.label.textContent = on ? `Quantize · ${bits}` : '';
      parts.btn.title = on
        ? `Lens — Quantize ${bits}`
        : window.Iro.t('ui.module.lens');
    }

    /**
     * A lens edited in the Lens window: persist it on the instance that owns it and tell
     * the module, so its maps rebuild. Deliberately does not go through `patchSettings`:
     * that one no-ops when a record has no ctx, which left the card's label cleared but
     * the map still banded (the "turning the lens off does nothing" report).
     */
    applyLens(instanceId, lens) {
      const record = this.recordFor(instanceId);
      if (!record) return false;
      if (record.lens) this._paintLens(record.lens, lens);
      record.settings.lens = lens || null;
      try {
        if (record.instance && record.instance.onSettings) record.instance.onSettings({ ...record.settings });
      } catch (err) {
        console.warn('[lens] onSettings failed', err && err.message);
      }
      this._scheduleSave(instanceId, record.settings, record.def && record.def.version, record.id);
      return true;
    }

    /**
     * Re-read one instance's lens from the store (a change made in another window) and
     * apply it if it really changed. Cheap and idempotent: a `module:changed` burst that
     * carries no lens edit does nothing.
     */
    async reloadLens(instanceId) {
      const record = this.recordFor(instanceId);
      if (!record || !record.def || !record.def.lens || !record.ctx) return false;
      let stored = null;
      try { stored = await this.csp.getModuleSettings(instanceId, record.id); } catch { stored = null; }
      if (!stored) return false;
      const next = stored.lens || null;
      const cur = record.settings.lens || null;
      if (JSON.stringify(next) === JSON.stringify(cur)) return false;
      if (record.lens) this._paintLens(record.lens, next);
      record.settings.lens = next;
      try {
        if (record.instance && record.instance.onSettings) record.instance.onSettings({ ...record.settings });
      } catch {  }
      return true;
    }

    /** Coalesced "my minimum size may have changed, re-read it" request. */
    _scheduleLayout() {
      if (this._layoutTimer) clearTimeout(this._layoutTimer);
      this._layoutTimer = setTimeout(() => {
        this._layoutTimer = null;
        if (typeof this.onLayoutRequest === 'function') this.onLayoutRequest();
      }, 250);
    }

    /** Persist a module's settings, coalescing bursts of changes. */
    _scheduleSave(id, settings, version, moduleId) {
      const prev = this._saveTimers.get(id);
      if (prev) clearTimeout(prev);
      const timer = setTimeout(() => {
        this._saveTimers.delete(id);
        this.csp.saveModuleSettings(id, settings, version, moduleId).catch(() => {});
      }, 250);
      this._saveTimers.set(id, timer);
    }
  }

  window.Iro = window.Iro || {};
  window.Iro.ModuleHost = ModuleHost;
})();

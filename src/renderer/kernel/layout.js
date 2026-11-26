'use strict';

(function () {
  const MIN_COLUMN = 120;
  const MIN_MODULE = 44;
  const BOARD_PAD = 2;
  const DIVIDER_W = 2;
  const MODULE_GAP = 2;

  const PALETTE_MIN_H = 340;

  const DEFAULT_WEIGHT = { 'csp-color': 12, 'color-slices': 420, 'color-slider': 92, 'color-history': 90 };

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

  class Board {
    constructor({ root, host, csp, defaultLayout, load, save, resize, float, floatId, subscribe }) {
      this.root = root;
      this.host = host;

      if (typeof MutationObserver === 'function') {
        this._metricsObserver = new MutationObserver(() => this._reportMetrics());
        this._metricsObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
      }

      this._selection = [];
      this._selAnchor = null;
      this.csp = csp;

      if (csp && typeof csp.onLensApply === 'function') {
        csp.onLensApply((msg) => {
          if (!msg || !msg.instanceId) return;
          if (this.host && this.host.applyLens) this.host.applyLens(msg.instanceId, msg.lens);
        });
      }
      this.defaultLayout = defaultLayout || { version: 1, columns: [] };

      this.float = Boolean(float);
      this.floatId = floatId || null;

      this._subscribe = subscribe !== false;
      this._load = load || (() => csp.getLayout());
      this._persist = save || ((layout) => csp.saveLayout(layout));
      if (typeof resize !== 'function') throw new TypeError('Board needs a resize callback');
      this._resize = resize;
      this.layout = { version: 1, floats: [], columns: [] };
      this.columns = new Map();
      this.modules = new Map();

      this._renderGen = 0;
      this._saveTimer = null;
      this._dragInstance = null;
      this._indicator = null;
      this._dropBox = null;
      this._sameCard = null;
      this._dropTarget = null;
      this._dropKey = null;

      this._palette = null;
      this._unsnapBtn = null;

      this._moduleEdgeDrag = false;
      this._fitFrame = 0;
    }

    async init() {
      this.host.onLayoutRequest = () => this.refreshSizes();

      if (this._subscribe && this.csp.onLayoutChanged) this.csp.onLayoutChanged((layout) => this.applyLayout(layout));
      if (this.csp.onModuleChanged) {
        this.csp.onModuleChanged((spec) => {

          const changed = spec && spec.id;
          if (changed && this.host && this.host.reloadLens) this.host.reloadLens(changed);

          if (this._modTimer) clearTimeout(this._modTimer);
          this._modTimer = setTimeout(() => {
            this._modTimer = null;
            this.render();
          }, 200);
        });
      }
      if (this.csp.onModuleAction) this.csp.onModuleAction((payload) => this._moduleAction(payload));

      let saved = null;
      try { saved = await this._load(); } catch { saved = null; }
      this.layout = this._normalize(saved || this.defaultLayout);

      if (!saved || JSON.stringify(saved.columns) !== JSON.stringify(this.layout.columns)) this._save();
      await this.render();

      if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => {
          if (this._minRaf) return;
          this._minRaf = requestAnimationFrame(() => {
            this._minRaf = 0;
            this._reconcile();
          });
        });
        ro.observe(this.root);
        this._minRo = ro;
      }
    }

    /** Lock the layout: modules and columns can't be dragged (settings still open). */
    setLocked(locked) {
      this.locked = Boolean(locked);
      this.root.classList.toggle('locked', this.locked);
    }

    /** Adopt a layout pushed from elsewhere (the Settings window). */
    applyLayout(layout) {

      if (layout && layout.palette) this._setPaletteState(layout.palette);
      const collapsed = ((layout && layout.columns) || []).length > 1;
      const next = this._normalize(layout || this.defaultLayout);

      if (JSON.stringify(next) === JSON.stringify(this.layout)) {

        if (collapsed) this._save();
        return;
      }

      const structural = this._structureKey(next) !== this._structureKey(this.layout);
      this.layout = next;
      if (structural) this.render();
      else this._retune();
      this._save();
    }

    /** The column/module structure (ids and order), ignoring sizes. */
    _structureKey(layout) {
      return ((layout && layout.columns) || [])
        .map((c) => `${c.id}:${(c.modules || []).map((m) => m.instanceId).join(',')}`)
        .join('|');
    }

    /** Re-apply each card's size in place, then re-fit — no teardown, so no flash. */
    _retune() {
      for (const col of this.layout.columns) {
        const entry = this.columns.get(col.id);
        if (!entry) continue;
        for (const mod of col.modules) {
          const inst = this.modules.get(mod.instanceId);
          if (inst) {

            inst.model = mod;
            this._applyModuleWeight(inst.el, mod, this._moduleWeightOpts(col, mod));
          }
        }
        this._syncSplits(entry.el);
      }
      requestAnimationFrame(() => this._reconcile());
    }

    getLayout() {
      return JSON.parse(JSON.stringify(this.layout));
    }

    _normalize(input) {

      const out = { version: 1, floats: [], columns: [] };
      const used = new Set();
      const columns = input && Array.isArray(input.columns) ? input.columns : [];
      columns.forEach((raw, index) => {
        const column = {
          id: raw && raw.id ? String(raw.id) : `c${index + 1}`,
          width: raw && Number.isFinite(raw.width) ? Math.max(1, Math.round(raw.width)) : null,
          modules: [],
        };
        const mods = raw && Array.isArray(raw.modules) ? raw.modules : [];
        for (const mod of mods) {
          if (!mod || !mod.moduleId) continue;
          let instanceId = mod.instanceId ? String(mod.instanceId) : '';
          if (!instanceId || used.has(instanceId)) {
            let n = used.size + 1;
            while (used.has(`i${n}`)) n += 1;
            instanceId = `i${n}`;
          }
          used.add(instanceId);

          const rawWeight = Number.isFinite(mod.weight) ? mod.weight
            : (Number.isFinite(mod.height) ? mod.height : null);
          const rawRatio = Number.isFinite(mod.ratio) && mod.ratio > 0 ? mod.ratio : null;
          column.modules.push({
            instanceId,
            moduleId: String(mod.moduleId),
            weight: rawWeight != null ? Math.max(1, Math.round(rawWeight)) : null,
            ratio: rawRatio,
            collapsed: mod.collapsed === true,
          });
        }
        out.columns.push(column);
      });

      if (out.columns.length > 1) {
        out.columns = [{
          id: out.columns[0].id,
          width: null,
          modules: out.columns.flatMap((c) => c.modules),
        }];
      }

      const kept = out.columns.filter((col) => col.modules.length > 0);
      out.columns = kept.length
        ? kept
        : [{ id: (out.columns[0] && out.columns[0].id) || 'c1', width: null, modules: [] }];
      return out;
    }

    async render() {
      this._renderGen += 1;
      this._teardown();
      const columns = this.layout.columns;
      for (let i = 0; i < columns.length; i++) {
        if (i > 0) this.root.append(this._makeDivider(columns[i - 1]));
        await this._renderColumn(columns[i]);
      }

      if (this.float) {
        const lone = this.layout.columns.length === 1
          && this.layout.columns[0].modules.length === 1;
        document.body.classList.toggle('float-single', lone);
        this._applyLoneHeader(lone);
      }

      this._selection = this._selection.filter((id) => this.modules.has(id));
      this._paintSelection();

      requestAnimationFrame(() => this._reconcile());
    }

    /** Highlight the palette while a float hovers over it, about to dock. */
    setDockHint(on) {
      this.root.classList.toggle('dock-target', Boolean(on));
    }

    /** Hide the window's contents while it is dragged over the palette. */    /**
     * Collapse a float to its grip bar (the board is hidden) and expand it
     * again. The eye in the grip, or in a lone module's header while expanded,
     * drives this; it is a float-only affordance.
     */
    toggleFloatCollapsed(force) {
      if (!this.float) return false;
      const on = force === undefined
        ? !document.body.classList.contains('float-collapsed')
        : Boolean(force);
      if (on === document.body.classList.contains('float-collapsed')) return on;
      document.body.classList.toggle('float-collapsed', on);

      if (this.csp.floatCollapsed) this.csp.floatCollapsed(this.floatId, on);
      if (on) {
        this._expandedHeight = Math.max(1, window.innerHeight);

        if (this.csp.setMinSizeSelf) this.csp.setMinSizeSelf(90, 1);
        if (this.csp.setResizableSelf) this.csp.setResizableSelf(false);

        this._resize(window.innerWidth, 14);
      } else {
        if (this.csp.setMinSizeSelf) this.csp.setMinSizeSelf(90, 60);
        if (this.csp.setResizableSelf) this.csp.setResizableSelf(!this.locked);
        this._resize(window.innerWidth, Math.max(60, this._expandedHeight || 60));
      }
      return on;
    }

    /** Rename this window's palette (main validates and persists it). */
    setPaletteName(name) {
      const wanted = String(name == null ? '' : name).trim();
      if (!wanted || !this.csp.renamePalette) return Promise.resolve(false);
      if (wanted === this._paletteName) return Promise.resolve(true);
      this._paletteName = wanted;
      return this.csp.renamePalette({ paletteId: this._paletteId, name: wanted })
        .then((res) => Boolean(res && res.ok))
        .catch(() => false);
    }

    /**
     * Adopt this window's own palette state (name, snap, followers). Main is the
     * source of truth, so a rename made in Settings, a join made by a drag and the
     * group coming free all arrive here.
     */
    _setPaletteState(state, { quietName = false } = {}) {
      if (!state) return;
      this._palette = { ...(this._palette || {}), ...state };
      if (state.id) this._paletteId = state.id;
      if (state.name && !quietName) this._paletteName = state.name;
      if (this._nameInput && document.activeElement !== this._nameInput) {
        this._nameInput.value = this._headerName();
      }
      this._paintUnsnap();
    }

    /**
     * The titlebar's Unsnap icon: shown while this palette is in a snap group — either
     * because it is joined to an anchor (`snap`) or because it anchors followers. It is
     * not in the hamburger menu: that was two clicks for a gesture whose whole point is
     * "come free".
     */
    bindUnsnap(button) {
      if (!button) return;
      this._unsnapBtn = button;
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.csp.unsnapPalette) this.csp.unsnapPalette().catch(() => {});
      });
      if (this.csp.paletteState) {
        this.csp.paletteState().then((state) => {
          if (state) this._setPaletteState(state, { quietName: true });
        }).catch(() => {  });
      }
      this._paintUnsnap();
    }

    _paintUnsnap() {
      const btn = this._unsnapBtn;
      if (!btn) return;
      const inGroup = Boolean(this._palette && (this._palette.snap || this._palette.hasFollowers));
      btn.classList.toggle('hidden', !inGroup);
      btn.disabled = !inGroup;
    }

    /**
     * The palette menu (docs/LAYOUT.md, "One palette"): Rename, Lock, Settings, Delete. It is the
     * only way in — click-to-rename is gone, because a titlebar is a drag surface (so a field inside
     * one is never reliably clickable) and a float never had text focus at all. Delete asks for a
     * second click rather than opening a dialog: a dialog would steal focus from Clip Studio Paint.
     */
    bindPaletteMenu(spec) {
      const { button, menu, nameInput } = spec || {};
      if (!button || !menu) return;
      const item = (id) => menu.querySelector(id);
      const rename = item('#menu-rename');
      const del = item('#menu-delete');
      const close = () => menu.classList.add('hidden');

      const lockItem = item('#menu-lock');
      const settingsItem = item('#menu-settings');
      const labelLock = () => {
        if (!lockItem) return;
        lockItem.textContent = this.locked === true ? 'Unlock layout' : 'Lock layout';
      };
      if (lockItem) {
        lockItem.addEventListener('click', () => {
          const next = this.locked !== true;
          this.setLocked(next);
          if (this.csp.updateSettings) this.csp.updateSettings({ locked: next });
          close();
        });
      }
      const open = () => {
        menu.classList.remove('hidden');
        labelLock();
        if (del) {
          del.textContent = window.Iro.t('ui.layout.deletePalette');
          del.dataset.armed = '';
        }
      };
      /**
       * Open the menu. It is drawn by the **overlay window** (main moves a small always-on-top surface
       * to the button), because a renderer cannot paint outside its own window and a palette is
       * narrow — which is exactly why the in-window menu could never cross its edge. The in-window
       * menu above stays as a fallback for the case where the overlay is unavailable.
       */
      const showMenu = async () => {
        if (!this.csp.showPaletteMenu) { open(); return; }
        const rect = button.getBoundingClientRect();
        const spec = {
          items: [
            { id: 'rename', label: 'Rename…' },
            { id: 'lock', label: this.locked === true ? 'Unlock layout' : 'Lock layout' },
            { id: 'settings', label: 'Settings…' },
            {
              id: 'delete',
              label: this._deleteArmedAt ? 'Delete palette — click again' : 'Delete palette…',
              danger: true,
            },
          ],
          anchor: {
            x: Math.round(window.screenX + rect.left),
            y: Math.round(window.screenY + rect.bottom + 2),
          },
        };

        if (window.Iro && window.Iro.overlayMenu) {
          window.Iro.overlayMenu.show('palette', button, spec);
          return;
        }
        this.csp.showPaletteMenu(spec);
      };
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.csp.showPaletteMenu) { showMenu(); return; }
        if (menu.classList.contains('hidden')) open();
        else close();
      });
      if (this.csp.onPaletteMenuPick) {
        this.csp.onPaletteMenuPick((pick) => {
          if (pick && pick.menu && pick.menu !== 'palette') return;
          const id = pick && pick.id;
          if (id === 'rename') {
            close();
            if (!nameInput) return;

            nameInput.readOnly = false;
            nameInput.classList.add('editing');
            if (this.csp.setEditable) this.csp.setEditable(true);
            try { nameInput.focus(); nameInput.select(); } catch {  }
            return;
          }
          if (id === 'lock') {
            const next = this.locked !== true;
            this.setLocked(next);
            if (this.csp.updateSettings) this.csp.updateSettings({ locked: next });
            return;
          }
          if (id === 'settings') {
            close();
            if (this.csp.openSettings) this.csp.openSettings();
            return;
          }
          if (id === 'delete') {

            const now = Date.now();
            if (!this._deleteArmedAt || now - this._deleteArmedAt > 3000) {
              this._deleteArmedAt = now;
              showMenu();
              return;
            }
            this._deleteArmedAt = 0;
            close();
            if (this.csp.deletePalette) this.csp.deletePalette();
          }
        });
      }

      if (!this.csp.showPaletteMenu) {

        document.addEventListener('pointerdown', (e) => {
          if (menu.classList.contains('hidden')) return;
          if (menu.contains(e.target) || button.contains(e.target)) return;
          close();
        });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && !menu.classList.contains('hidden')) close();
        });
        if (rename) {
          rename.addEventListener('click', () => {
            close();
            if (!nameInput) return;
            nameInput.readOnly = false;
            nameInput.classList.add('editing');
            if (this.csp.setEditable) this.csp.setEditable(true);
            try { nameInput.focus(); nameInput.select(); } catch {  }
          });
        }
        if (settingsItem) {
          settingsItem.addEventListener('click', () => {
            close();
            if (this.csp.openSettings) this.csp.openSettings();
          });
        }
        if (del) {
          del.addEventListener('click', () => {
            if (del.dataset.armed !== '1') {
              del.dataset.armed = '1';
              del.textContent = window.Iro.t('ui.layout.confirmDelete');
              return;
            }
            close();
            if (this.csp.deletePalette) this.csp.deletePalette();
          });
        }
      }
    }

    /**
     * Show this window's own name in the chrome, and let it be edited in place.
     * "Iroiroppa" lives in Settings now; a window shows which palette it is.
     */
    bindPaletteName(input) {
      if (!input) return;
      this._nameInput = input;
      const paint = () => {
        if (document.activeElement !== input) input.value = this._headerName();
      };
      if (this.csp.paletteState) {
        this.csp.paletteState()
          .then((state) => {
            if (!state) return;
            this._setPaletteState(state, { quietName: true });
            this._paletteName = state.name;
            paint();
          })
          .catch(() => {  });
      }
      const revert = () => { input.value = this._headerName(); };
      const stopEditing = () => {
        input.readOnly = true;
        input.classList.remove('editing');
        if (this.csp.setEditable) this.csp.setEditable(false);
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        } else if (e.key === 'Escape') {

          e.stopPropagation();
          revert();
          input.blur();
        }
      });
      input.addEventListener('blur', () => {
        const name = input.value.trim();
        if (!name || name === this._paletteName) {
          revert();
          stopEditing();
          return;
        }
        const previous = this._paletteName;
        this.setPaletteName(name).then((ok) => {
          if (!ok) {
            this._paletteName = previous;
            revert();
          }
        }).finally(stopEditing);
      });
    }

    /** Draw a line along any edge that is joined to another window. */    /** Re-check the window minimum after a theme changed a structural token. */
    remeasure() {
      this._enforceWindowMin();
    }

    _enforceWindowMin() {

      if (!this.root.clientHeight || document.body.classList.contains('collapsed')
        || document.body.classList.contains('float-collapsed')) return;

      if (Date.now() < (this._resizeGraceUntil || 0)) return;
      const min = this.minWindowSize();

      const natural = this._naturalHeight();
      const needH = natural ? Math.max(min.height, natural) : min.height;

      if (window.innerWidth < min.width - 1 || window.innerHeight < needH - 1) {

        const w = Math.max(min.width, window.innerWidth);
        const h = Math.max(needH, window.innerHeight);
        this._appliedW = w;
        this._appliedH = h;

        this._resizeGraceUntil = Date.now() + 150;
        this._resize(w, h);
      }
    }

    /** True when every module in every column fits its own size (no fill module). */
    _allNatural() {
      return this.layout.columns.every((col) => col.modules.every(
        (m) => this._isRigid(m) || this._isNatural(m),
      ));
    }

    /**
     * The window height that fits the content (including window chrome), or 0
     * when a fill module wants the slack. A locked-ratio module's height is real
     * pixels, so a column can need more than its minimum.
     */
    _naturalHeight() {
      if (!this.layout.columns.length || !this._allNatural()) return 0;
      let contentH = MIN_MODULE;
      for (const col of this.layout.columns) {
        const entry = this.columns.get(col.id);
        if (!entry) continue;
        const cards = [...entry.el.children].filter((n) => n.classList.contains('module'));
        if (cards.length) {
          const first = cards[0].getBoundingClientRect();
          const last = cards[cards.length - 1].getBoundingClientRect();
          contentH = Math.max(contentH, last.bottom - first.top);
        }
      }
      const chromeH = window.innerHeight - this.root.clientHeight;
      return Math.round(contentH + BOARD_PAD * 2 + 4 + chromeH);
    }

    /**
     * Follow a module-edge drag with a window height change. `_fitToContent` only
     * shrinks and `_enforceWindowMin` only grows; this one does both, and avoids
     * `_handleUserDrag` mistaking the programmatic fit for a window-edge drag.
     */
    _fitNaturalWindow() {
      if (this.locked) return;
      if (document.body.classList.contains('collapsed')
        || document.body.classList.contains('float-collapsed')) return;
      if (!this.layout.columns.length || !this._allNatural()) return;
      const natural = this._naturalHeight();
      if (!natural) return;
      const min = this.minWindowSize();
      const floor = this._hasCollapsedModule()
        ? Math.max(60, min.height)
        : (this.float ? Math.max(60, min.height) : PALETTE_MIN_H);
      const want = Math.max(floor, Math.round(natural));
      if (Math.abs(want - window.innerHeight) <= 1) return;
      this._fitUntil = Date.now() + 1000;

      if (this.csp.setMinSizeSelf && floor < PALETTE_MIN_H) {
        this.csp.setMinSizeSelf(min.width, Math.max(60, min.height));
        this._fitLoweredMin = true;
      }
      this._applyWindowSize(window.innerWidth, want);
    }

    /** Does any module still sit collapsed to its header? */
    _hasCollapsedModule() {
      return (this.layout.columns || []).some((col) => (col.modules || []).some((m) => m.collapsed));
    }

    /** Does a module fill its column (so no natural height exists)? */
    _hasFillModule() {
      return (this.layout.columns || []).some((col) => (col.modules || []).some(
        (m) => m && !m.collapsed && !this._isNatural(m) && !this._isRigid(m),
      ));
    }

    /**
     * After a minimize/expand, fit the window: shrinks on the way down, grows on
     * the way up. A fill module's expanded height is unknowable from content, so
     * the last expand restores the pre-collapse height instead of leaving it
     * clipped in the shrunken window.
     */
    _fitAfterCollapse() {
      this._fitNaturalWindow();
      if (this._hasCollapsedModule()) return;
      const snapshot = this._collapseSnapshot;
      this._collapseSnapshot = null;
      if (!snapshot) return;
      if (!this._hasFillModule()) return;
      if (window.innerHeight >= snapshot.height - 1) return;
      this._fitUntil = Date.now() + 1000;
      this._applyWindowSize(window.innerWidth, snapshot.height);
    }

    /**
     * Shrink this board's window to its content when nothing in it wants the
     * slack — i.e. every module in every column is rigid or natural, so no
     * module fills its column. A palette holding a single one-row module
     * otherwise keeps its old height and leaves a band of empty space under the
     * card. Shrink only; growing is `_enforceWindowMin`'s job.
     */
    /** One reconcile pass: a user drag first, then grow onto the content and fit. */
    _reconcile() {
      if (this._handleUserDrag()) return;
      this._enforceWindowMin();
      this._fitToContent();

      if (this._allNatural() && !this._hasCollapsedModule()) {
        const natural = this._naturalHeight();
        if (natural && natural > window.innerHeight + 1) this._fitNaturalWindow();
      }
    }

    /**
     * A top/bottom-edge drag moves the window height but not the width, and leaves the
     * content alone. Rather than snapping it back (which made the drag do nothing), scale
     * the width to the dragged height — the palette keeps its width:height ratio, and the
     * next pass fits the height to the new width. Returns true when it resized the window.
     */
    _handleUserDrag() {
      if (this.float || this.locked) return false;
      if (this._moduleEdgeDrag) return false;
      if (document.body.classList.contains('collapsed')
        || document.body.classList.contains('float-collapsed')
        || document.body.classList.contains('dragging')) return false;
      if (Date.now() < (this._resizeGraceUntil || 0)) return false;
      if (!this.layout.columns.length || !this._allNatural()) return false;
      const width = window.innerWidth;

      const userWidth = this._appliedW != null && Math.abs(width - this._appliedW) > 3;
      const userHeight = this._appliedH != null && Math.abs(window.innerHeight - this._appliedH) > 3;
      if (userWidth || !userHeight) return false;

      if (Date.now() < (this._fitUntil || 0)) return false;
      const target = this._naturalHeight();
      if (!target || this._fitWidth == null) return false;
      const perWidth = target / Math.max(1, this._fitWidth);
      if (!(perWidth > 0)) return false;
      const minW = this.minWindowSize().width;
      const avail = window.screen && window.screen.availWidth ? window.screen.availWidth : 4000;
      const targetW = Math.min(Math.max(minW, avail - 40), Math.max(minW, Math.round(window.innerHeight / perWidth)));
      if (Math.abs(targetW - width) <= 2) return false;
      this._fitWidth = targetW;
      this._applyWindowSize(targetW, window.innerHeight);
      return true;
    }

    /**
     * Shrink this board's window to its content when nothing in it wants the slack
     * — i.e. every module in every column is rigid or natural, so no module fills
     * its column. Shrink only; growing is `_enforceWindowMin`'s job.
     */
    _fitToContent() {

      if (document.body.classList.contains('collapsed')
        || document.body.classList.contains('float-collapsed')) return;

      if (this.locked) return;
      if (document.body.classList.contains('dragging')) return;
      if (Date.now() < (this._resizeGraceUntil || 0)) return;
      const cols = this.layout.columns;
      if (!cols.length) return;

      if (!this._allNatural()) {
        if (this._fitLoweredMin) {
          this._fitLoweredMin = false;
          if (this.csp.setMinSizeSelf) {
            const floor = this.float ? this.minWindowSize().height : PALETTE_MIN_H;
            this.csp.setMinSizeSelf(this.minWindowSize().width, floor);
          }
        }
        return;
      }
      const target = Math.max(60, this._naturalHeight());
      if (!target) return;
      this._fitWidth = window.innerWidth;
      this._fitContentH = target - (window.innerHeight - this.root.clientHeight);

      const min = this.minWindowSize();
      if (this.csp.setMinSizeSelf) {
        this.csp.setMinSizeSelf(min.width, min.height);
        this._fitLoweredMin = true;
      }

      const floor = this._hasCollapsedModule()
        ? Math.max(60, min.height)
        : (this.float ? Math.max(60, min.height) : PALETTE_MIN_H);
      const wantH = Math.max(floor, Math.round(target));

      this._fitUntil = Date.now() + 1000;
      if (wantH < window.innerHeight - 1) {

        this._appliedH = wantH;
        this._applyWindowSize(window.innerWidth, wantH);
      }
    }

    _teardown() {
      for (const entry of this.modules.values()) {
        const instance = entry.record && entry.record.instance;
        if (instance && typeof instance.destroy === 'function') {
          try { instance.destroy(); } catch {  }
        }
        if (entry.record && entry.record.ro) entry.record.ro.disconnect();
      }
      this.modules.clear();
      this.columns.clear();
      this._edgeLines = null;
      this.host.reset();
      this.root.replaceChildren();
    }

    async _renderColumn(col) {
      const el = document.createElement('div');
      el.className = 'column';
      el.dataset.column = col.id;
      this._applyColumnWidth(el, col);
      this.root.append(el);
      const entry = { model: col, el };
      this.columns.set(col.id, entry);
      await this._syncColumn(entry);
    }

    async _syncColumn(entry) {
      const { model: col, el } = entry;
      const placeholder = el.querySelector('.column-empty');
      if (col.modules.length) {
        if (placeholder) placeholder.remove();
      } else if (!placeholder) {
        el.append(this._makePlaceholder());
      }

      const gen = this._renderGen;
      const owns = () => {
        if (gen !== this._renderGen) return false;
        if (el.isConnected) return true;
        const current = this.columns.get(col.id);
        if (!current || current.el !== el) return false;
        this.root.append(el);
        return true;
      };
      for (const mod of col.modules) {
        if (!owns()) return;
        if (this.modules.has(mod.instanceId)) continue;
        try {
          await this._mountModule(col, mod, el, owns);
        } catch (err) {

          this.host.log && this.host.log('mount failed', mod.moduleId, err && err.message);
        }
      }
      this._syncSplits(el);

      this._applyColumnWidth(el, col);
    }

    /** Put a drag handle between each pair of adjacent modules. */
    _syncSplits(colEl) {
      colEl.querySelectorAll('.module-split, .module-edge').forEach((node) => node.remove());
      const cards = [...colEl.children].filter((node) => node.classList.contains('module'));
      for (let i = 0; i < cards.length - 1; i++) {
        const above = this.modules.get(cards[i].dataset.instance);
        const below = this.modules.get(cards[i + 1].dataset.instance);

        const a = above && above.model;
        const b = below && below.model;
        const mineAbove = Boolean(
          (a && this._ratioOf(a))
          || (a && (a.weight != null || this._isUnitSized(a))),
        );
        const weightsOnly = Boolean(
          (b && (b.weight != null || this._isUnitSized(b))),
        );
        const resizable = mineAbove || weightsOnly;
        if (above && below && resizable) colEl.insertBefore(this._makeSplit(above, below), cards[i + 1]);
      }

      const last = cards[cards.length - 1];
      const lastEntry = last && this.modules.get(last.dataset.instance);
      if (lastEntry && this._ratioOf(lastEntry.model)) colEl.append(this._makeEdge(lastEntry));
    }

    /** The column model that owns an entry's card (for alone/stretchLast opts). */
    _columnModelFor(entry) {
      const el = entry && entry.el && entry.el.parentElement;
      if (!el) return null;
      for (const c of this.columns.values()) if (c.el === el) return c.model;
      return null;
    }

    /** A ratio drag's start state: which module, from which edge, and its box. */
    _ratioDragState(entry, fromAbove) {
      const rect = entry.el.getBoundingClientRect();
      const col = this._columnModelFor(entry);
      return {
        ratioEntry: entry,
        fromAbove,
        top: rect.top,
        bottom: rect.bottom,
        width: Math.max(1, entry.el.offsetWidth),
        col,
      };
    }

    /** Drag a module's edge: its height/width ratio, the same value the slider sets. */
    _dragRatio(drag, clientY) {
      const entry = drag.ratioEntry;
      const mod = entry.model;
      const raw = drag.fromAbove ? clientY - drag.top : drag.bottom - clientY;
      const min = this._minHeightOf(mod);
      const LM = window.IroLayoutModel;
      const ratio = LM && typeof LM.ratioFromDrag === 'function'
        ? LM.ratioFromDrag(raw, drag.width, min)
        : clamp(Math.max(min, raw) / drag.width, 0.05, 2.5);
      if (ratio === null || mod.ratio === ratio) return;
      mod.ratio = ratio;
      mod.weight = null;
      this._applyModuleWeight(entry.el, mod, this._moduleWeightOpts(drag.col, mod));
      if (!this._fitFrame) {
        this._fitFrame = requestAnimationFrame(() => {
          this._fitFrame = 0;
          this._fitNaturalWindow();
        });
      }
    }

    /** The last module's bottom edge (a zero-height flex item, like the splitter). */
    _makeEdge(entry) {
      const edge = document.createElement('div');
      edge.className = 'module-edge';
      let drag = null;
      const move = (ev) => { if (drag) this._dragRatio(drag, ev.clientY); };
      const end = () => {
        if (!drag) return;
        drag = null;
        this._moduleEdgeDrag = false;
        if (this._fitFrame) {
          cancelAnimationFrame(this._fitFrame);
          this._fitFrame = 0;
        }
        this._fitNaturalWindow();
        this._save();
      };
      edge.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0 || this.locked) return;
        drag = this._ratioDragState(entry, true);
        this._moduleEdgeDrag = true;
        try { edge.setPointerCapture(ev.pointerId); } catch {  }
        ev.preventDefault();
      });
      edge.addEventListener('pointermove', move);
      edge.addEventListener('pointerup', end);
      edge.addEventListener('pointercancel', end);
      return edge;
    }

    async _mountModule(col, mod, colEl, owns) {

      await this.host.load([mod.moduleId]).catch(() => {});
      let openSettings = () => {};
      const lone = this.float && this._isLoneModule(mod.instanceId);
      const def = window.Iro.modules && window.Iro.modules[mod.moduleId];
      const record = await this.host.mount(mod.moduleId, colEl, mod.instanceId, {
        onSettings: () => openSettings(),
        float: this.float,

        headless: Boolean(def && def.headless) || lone,

        compact: Boolean(def && def.compact),
        lone,
        onCollapse: lone ? () => this.toggleFloatCollapsed() : undefined,
      });

      if (owns && !owns()) {
        this.host.drop(record);
        return;
      }
      const card = record.el;
      this._applyModuleWeight(card, mod, this._moduleWeightOpts(col, mod));

      const cardAnchor = () => {
        const rect = card.getBoundingClientRect();
        return {
          left: Math.round(window.screenX + rect.left),
          right: Math.round(window.screenX + rect.right),
          top: Math.round(window.screenY + rect.top),
        };
      };
      openSettings = () => {
        this.csp.openModuleSettings({
          moduleId: mod.moduleId,
          instanceId: mod.instanceId,
          anchor: cardAnchor(),
        });
      };

      const lensBtn = card.querySelector('.module-lens');
      if (lensBtn && typeof this.csp.openLens === 'function') {
        lensBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const settings = this.host ? this.host.settingsFor(mod.instanceId) : {};
          this.csp.openLens({
            moduleId: mod.moduleId,
            instanceId: mod.instanceId,
            name: this.host && this.host.recordFor(mod.instanceId)
              ? (this.host.recordFor(mod.instanceId).def.name || mod.moduleId)
              : mod.moduleId,
            anchor: cardAnchor(),
            lens: settings.lens || null,
          });
        });
      }

      const head = card.querySelector('.module-head');
      if (head) {
        head.addEventListener('pointerdown', (ev) => {
          if (ev.target.closest('.module-settings')
            || ev.target.closest('.module-lens')
            || ev.target.closest('.module-dock')
            || ev.target.closest('.module-collapse')) return;
          if (this.locked) return;

          const sel = this._selectionFor(ev, mod.instanceId);
          this._selection = sel.ids;
          this._selAnchor = sel.anchor;
          this._paintSelection();

          this._beginDrag(ev, mod.instanceId);
        });
      }

      const dots = card.querySelector('.module-settings');
      if (dots) {
        dots.addEventListener('pointerdown', (ev) => {
          if (ev.button !== 0 || this.locked) return;
          ev.stopPropagation();
          this._beginDrag(ev, mod.instanceId, openSettings);
        });
      }

      const minBtn = card.querySelector('.module-collapse');
      if (minBtn) {
        const current = () => (this.modules.get(mod.instanceId) || {}).model || mod;
        const paint = () => {
          const item = current();
          const label = window.Iro.t(item.collapsed ? 'ui.module.expand' : 'ui.module.collapse');
          minBtn.title = label;
          minBtn.setAttribute('aria-label', label);
          minBtn.setAttribute('aria-expanded', String(!item.collapsed));
        };
        paint();
        minBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const item = current();
          const wasCollapsed = Boolean(item.collapsed);

          if (!wasCollapsed && !this._collapseSnapshot) {
            this._collapseSnapshot = { width: window.innerWidth, height: window.innerHeight };
          }
          item.collapsed = !item.collapsed;
          this._applyModuleWeight(card, item, this._moduleWeightOpts(col, item));
          paint();

          if (this.csp.setModuleCollapsed) {
            const pending = this.csp.setModuleCollapsed(mod.instanceId, item.collapsed);
            if (pending && typeof pending.catch === 'function') pending.catch(() => {});
          }
          requestAnimationFrame(() => this._fitAfterCollapse());
        });
      }

      const compactDef = window.Iro.modules && window.Iro.modules[mod.moduleId];
      if (compactDef && compactDef.compact) {
        const row = card.querySelector('.module-body');
        if (row) {
          row.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0 || this.locked) return;
            if (ev.target.closest('button, input, select, textarea, a')) return;
            ev.stopPropagation();
            this._beginDrag(ev, mod.instanceId);
          });
        }
      }
      colEl.append(card);
      this.modules.set(mod.instanceId, { model: mod, record, el: card, columnId: col.id });
    }

    _applyColumnWidth(el, col) {

      const count = this.layout.columns.length || 1;
      const basis = col.width == null
        ? Math.max(MIN_COLUMN, Math.round((this.root.clientWidth || 0) / count))
        : Math.max(1, Math.round(col.width));
      el.style.flex = `${basis} 1 ${basis}px`;
      el.style.minWidth = `${this._columnMinWidth(col)}px`;
    }

    /** A module's share of its column (a proportional flex weight). */
    _weightOf(mod) {
      if (!mod) return 100;
      if (Number.isFinite(mod.weight)) return Math.max(1, mod.weight);
      return DEFAULT_WEIGHT[mod.moduleId] || 100;
    }

    /** Does this module keep its own size rather than taking a column share? */
    _isNatural(mod) {
      if (!mod) return false;

      if (mod.collapsed) return true;
      if (mod.weight != null) return false;
      if (this._ratioOf(mod)) return true;
      const def = window.Iro.modules && window.Iro.modules[mod.moduleId];
      if (def && def.autoHeight) return true;
      return this._isUnitSized(mod);
    }

    /**
     * Does this module keep its own height *even when it is alone in a column* (`def.rigid`)?
     * Session is one row: stretching it to fill the column is exactly what made it "too big and not
     * one line", and no splitter drag can help it. The column then carries the slack — the one
     * deliberate exception to "nothing may leave empty space" (docs/INVARIANTS.md).
     */
    _isRigid(mod) {
      if (!mod) return false;
      const def = window.Iro.modules && window.Iro.modules[mod.moduleId];
      return Boolean(def && def.rigid);
    }

    /** Does this module derive its size from its own settings (the slider)? */
    _isUnitSized(mod) {
      if (!mod) return false;
      const record = this.host.recordFor ? this.host.recordFor(mod.instanceId) : null;
      const inst = record && record.instance;
      return Boolean(inst && typeof inst.resizeTo === 'function');
    }

    /** A module's locked height:width ratio, or null when it does not use one. */
    _ratioOf(mod) {
      return mod && Number.isFinite(mod.ratio) && mod.ratio > 0 ? mod.ratio : null;
    }

    /** The weight options for a module in its column (see _applyModuleWeight). */
    _moduleWeightOpts(col, mod) {
      const mods = col && Array.isArray(col.modules) ? col.modules : [mod];
      return {
        alone: mods.length === 1,

        stretchLast: mods.length > 1
          && mods.every((m) => this._isNatural(m))
          && mods[mods.length - 1] === mod
          && !this._ratioOf(mod),
      };
    }

    /**
     * A size-drag finished on a module whose size comes from its settings: ask it
     * for the settings that match the box it now has (the slider's gap).
     */
    _applyModuleUnit(entry, box) {
      if (!entry || !entry.model) return;
      const record = this.host.recordFor ? this.host.recordFor(entry.model.instanceId) : null;
      const inst = record && record.instance;
      if (!inst || typeof inst.resizeTo !== 'function') return;
      let patch = null;
      try { patch = inst.resizeTo(box || {}); } catch { patch = null; }
      if (patch && typeof patch === 'object') {
        this.host.patchSettings(entry.model.instanceId, patch);
      }
    }

    _applyModuleWeight(el, mod, opts = {}) {

      const minimized = Boolean(mod && mod.collapsed);
      el.classList.toggle('module-min', minimized);
      const ratio = this._ratioOf(mod);
      if (minimized) {

        el.style.aspectRatio = '';
        el.style.width = '100%';
        el.style.flex = '0 0 auto';
      } else if (ratio) {

        el.style.flex = '0 0 auto';
        el.style.aspectRatio = String(1 / ratio);
        el.style.width = '100%';
      } else {
        el.style.aspectRatio = '';
        const natural = this._isRigid(mod) || (!opts.alone && !opts.stretchLast && this._isNatural(mod));
        el.style.flex = natural ? '0 0 auto' : `${this._weightOf(mod)} 1 0`;
      }

      el.style.minHeight = `${this._minHeightOf(mod)}px`;
    }

    /** The smallest box a module needs to show everything (from its definition). */
    _minSizeOf(mod) {
      const settings = this.host.settingsFor(mod.instanceId);

      const record = this.host.recordFor ? this.host.recordFor(mod.instanceId) : null;
      const inst = record && record.instance;
      if (inst && typeof inst.minSize === 'function') {
        try { return inst.minSize(settings) || {}; } catch {  }
      }
      const def = window.Iro.modules && window.Iro.modules[mod.moduleId];
      if (def && typeof def.minSize === 'function') {
        try { return def.minSize(settings) || {}; } catch {  }
      }
      return {};
    }

    _minWidthOf(mod) {
      const size = this._minSizeOf(mod);

      return Math.max(48, Math.round((size.width || 80) * 0.75));
    }

    _minHeightOf(mod) {

      if (mod && mod.collapsed) return Math.max(20, this._headHeightOf(mod));
      const size = this._minSizeOf(mod);
      const content = Math.max(40, Number.isFinite(size.height) ? size.height : MIN_MODULE);

      return Math.max(24, Math.round((content + this._headHeightOf(mod)) * 0.5));
    }

    /** The card head's own height, in CSS px (0 for a module that mounts headless). */
    _headHeightOf(mod) {
      if (!mod) return 0;
      const def = window.Iro.modules && window.Iro.modules[mod.moduleId];
      if (def && (def.headless || def.compact)) return 0;
      const record = this.host.recordFor ? this.host.recordFor(mod.instanceId) : null;
      const head = record && record.el && record.el.querySelector('.module-head');
      const h = head ? Math.round(head.getBoundingClientRect().height) : 0;

      return h > 0 ? h : 24;
    }

    /** A column must be at least as wide as its widest module. */
    _columnMinWidth(col) {
      if (!col.modules.length) return 60;
      return Math.max(...col.modules.map((m) => this._minWidthOf(m)));
    }

    /** A column must be tall enough for all its modules plus their gaps. */
    _columnMinHeight(col) {
      const n = col.modules.length;
      if (!n) return 60;
      return col.modules.reduce((sum, m) => sum + this._minHeightOf(m), 0) + (n - 1) * MODULE_GAP;
    }

    /** The smallest CSS window size that keeps every module fully visible. */
    minWindowSize() {
      const cols = this.layout.columns;
      const pad = BOARD_PAD * 2;
      const dividers = Math.max(0, cols.length - 1) * DIVIDER_W;
      const sumCols = cols.reduce((sum, col) => sum + this._columnMinWidth(col), 0);
      const minBoardW = sumCols + dividers + pad + 4;
      const minBoardH = Math.max(40, ...cols.map((col) => this._columnMinHeight(col))) + pad + 4;
      const chromeW = window.innerWidth - this.root.clientWidth;
      const chromeH = window.innerHeight - this.root.clientHeight;
      return { width: minBoardW + chromeW, height: minBoardH + chromeH };
    }

    /**
     * The handle between two stacked modules. Dragging trades weight between
     * them, so the column's total height never changes (no scrollbar).
     */
    _makeSplit(aboveEntry, belowEntry) {
      const split = document.createElement('div');
      split.className = 'module-split';
      let drag = null;

      const move = (ev) => {
        if (!drag) return;
        if (drag.ratioEntry) {
          this._dragRatio(drag, ev.clientY);
          return;
        }
        const dy = ev.clientY - drag.startY;

        if (drag.unitAbove || drag.unitBelow) {
          const splitY = drag.splitTop + dy;
          if (drag.unitAbove) {
            const h = splitY - drag.aboveTop - 1;
            if (h > 12) this._applyModuleUnit(aboveEntry, { height: h });
          }
          if (drag.unitBelow) {
            const h = drag.belowBottom - splitY - 1;
            if (h > 12) this._applyModuleUnit(belowEntry, { height: h });
          }
          return;
        }
        let a = drag.w1 + dy * drag.perPx;
        let b = drag.w2 - dy * drag.perPx;
        if (a < drag.minA) { b -= drag.minA - a; a = drag.minA; }
        if (b < drag.minB) { a -= drag.minB - b; b = drag.minB; }
        aboveEntry.model.weight = Math.max(1, a);
        belowEntry.model.weight = Math.max(1, b);
        this._applyModuleWeight(aboveEntry.el, aboveEntry.model);
        this._applyModuleWeight(belowEntry.el, belowEntry.model);
      };
      const end = () => {
        if (!drag) return;
        drag = null;
        this._save();
      };
      split.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0 || this.locked) return;

        const ratioEntry = this._ratioOf(aboveEntry.model) ? aboveEntry : null;
        if (ratioEntry) {
          drag = this._ratioDragState(ratioEntry, ratioEntry === aboveEntry);
          try { split.setPointerCapture(ev.pointerId); } catch {  }
          ev.preventDefault();
          return;
        }
        const colEl = aboveEntry.el.parentElement;
        const cards = [...colEl.children].filter((node) => node.classList.contains('module'));
        const px = cards.reduce((sum, card) => sum + card.offsetHeight, 0);
        const total = cards.reduce((sum, card) => {
          const item = this.modules.get(card.dataset.instance);
          return sum + this._weightOf(item && item.model);
        }, 0);
        const perPx = px > 0 ? total / px : 1;
        const w1 = this._weightOf(aboveEntry.model);
        const w2 = this._weightOf(belowEntry.model);
        let minA = this._minHeightOf(aboveEntry.model) * perPx;
        let minB = this._minHeightOf(belowEntry.model) * perPx;

        if (w1 + w2 < minA + minB) { minA = 0; minB = 0; }
        drag = {
          startY: ev.clientY,
          w1,
          w2,
          perPx,
          minA,
          minB,
          unitAbove: this._isUnitSized(aboveEntry.model),
          unitBelow: this._isUnitSized(belowEntry.model),
          splitTop: split.getBoundingClientRect().top,
          aboveTop: aboveEntry.el.getBoundingClientRect().top,
          belowBottom: belowEntry.el.getBoundingClientRect().bottom,
        };
        split.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });
      split.addEventListener('pointermove', move);
      split.addEventListener('pointerup', end);
      split.addEventListener('pointercancel', end);
      return split;
    }

    _makeDivider(leftCol) {
      const divider = document.createElement('div');
      divider.className = 'column-divider';
      let drag = null;
      const move = (ev) => {
        if (!drag) return;
        const wanted = Math.round(drag.startW + (ev.screenX - drag.startX));
        const w = clamp(wanted, drag.minW, drag.maxW);
        drag.el.style.flex = `0 1 ${w}px`;
      };
      const end = () => {
        if (!drag) return;
        const entry = this.columns.get(leftCol.id);
        drag = null;

        for (const col of this.columns.values()) {
          col.model.width = Math.max(1, Math.round(col.el.offsetWidth));
          this._applyColumnWidth(col.el, col.model);

          for (const mod of col.model.modules) {
            this._applyModuleUnit({ model: mod, el: col.el }, { width: col.el.offsetWidth, height: col.el.offsetHeight });
          }
        }
        if (entry) entry.model.width = Math.max(1, Math.round(entry.el.offsetWidth));
        this._save();
      };
      divider.addEventListener('pointerdown', (ev) => {
        if (this.locked) return;
        const entry = this.columns.get(leftCol.id);
        if (!entry) return;

        const boardContent = this.root.clientWidth - BOARD_PAD * 2;
        const dividers = Math.max(0, this.layout.columns.length - 1) * DIVIDER_W;
        const othersMin = this.layout.columns
          .filter((col) => col.id !== leftCol.id)
          .reduce((sum, col) => sum + this._columnMinWidth(col), 0);
        const minW = this._columnMinWidth(entry.model);
        drag = {
          el: entry.el,
          startX: ev.screenX,
          startW: entry.el.offsetWidth,
          minW,
          maxW: Math.max(minW, boardContent - dividers - othersMin),
        };
        divider.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });
      divider.addEventListener('pointermove', move);
      divider.addEventListener('pointerup', end);
      divider.addEventListener('pointercancel', end);
      return divider;
    }

    _beginDrag(ev, instanceId, onOpen) {
      if (ev.button !== 0 || this.locked) return;

      this._clearDragState();
      const entry = this.modules.get(instanceId);
      if (!entry) return;
      const card = entry.el;
      const startX = ev.clientX;
      const startY = ev.clientY;

      const label = (card.closest('.module') || card).dataset.name || 'Module';
      let moved = false;
      let started = false;

      const stop = () => {
        card.classList.remove('dragging');
        document.body.classList.remove('dragging');
        this._dragInstance = null;
      };

      const move = (e) => {
        if (moved) return;

        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 12) return;
        moved = true;

        try { ev.target.setPointerCapture(ev.pointerId); } catch {  }
        this._dragInstance = instanceId;
        document.body.classList.add('dragging');

        const loneWindow = this.float && document.body.classList.contains('float-single');
        const trackOutside = (e) => {
          if (loneWindow) return;
          const out = e.clientX < 0 || e.clientY < 0
            || e.clientX > window.innerWidth || e.clientY > window.innerHeight;
          card.classList.toggle('dragging', out);
        };
        document.addEventListener('pointermove', trackOutside);
        this._trackOutside = trackOutside;

        started = true;
        const items = this._selection.includes(instanceId) ? [...this._selection] : [instanceId];
        this.csp.dragBegin({
          items,
          text: items.length > 1 ? `${label} +${items.length - 1}` : label,
          width: Math.round(card.offsetWidth),
          height: Math.round(card.offsetHeight),
        });
      };

      const finish = (cancelled) => {
        try { ev.target.releasePointerCapture(ev.pointerId); } catch {  }
        if (this._trackOutside) {
          document.removeEventListener('pointermove', this._trackOutside);
          this._trackOutside = null;
        }
        card.classList.remove('dragging');
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        document.removeEventListener('keydown', onKey);
        ev.target.removeEventListener('lostpointercapture', onLost);
        this._clearDropTarget();
        if (started) {
          if (cancelled) this.csp.dragCancel();
          else this.csp.dragDrop();
          started = false;
        } else if (!cancelled && onOpen) {

          onOpen();
        }
        if (moved) this._suppressClick = Date.now() + 400;
        stop();
      };
      const onUp = () => finish(false);
      const onCancel = () => finish(true);

      const onLost = () => finish(true);
      const onKey = (e) => {
        if (e.key === 'Escape') finish(true);
      };

      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
      document.addEventListener('keydown', onKey);
      ev.target.addEventListener('lostpointercapture', onLost);
    }

    /** Drop any drag state a previous drag may have left behind (see `_beginDrag`). */
    _clearDragState() {
      for (const el of document.querySelectorAll('.module.dragging')) el.classList.remove('dragging');
      document.body.classList.remove('dragging');
      this._dragInstance = null;
    }

    /** Is this module the only thing in a float window? */
    _isLoneModule(instanceId) {
      if (!this.float) return false;
      const columns = this.layout.columns;
      if (columns.length !== 1) return false;
      return columns[0].modules.length === 1 && columns[0].modules[0].instanceId === instanceId;
    }

    /**
     * What this window's header should say. A palette window says the palette's name; a window holding
     * exactly one module says **that module's** name, because a palette name tells you nothing about
     * the single card inside it (the user's report: a lone module's header showed "Palette 2").
     */
    _headerName() {
      if (this.float && this.layout) {
        const cols = this.layout.columns || [];
        if (cols.length === 1 && (cols[0].modules || []).length === 1) {
          const mod = cols[0].modules[0];
          const record = this.modules.get(mod.instanceId);
          const def = window.Iro.modules && window.Iro.modules[mod.moduleId];
          return (record && record.el && record.el.dataset.name) || (def && def.name) || mod.moduleId;
        }
      }
      return this._paletteName || '';
    }

    /**
     * A one-module window *is* that module's window: its header says the module's name (a palette name
     * says nothing useful for a window holding one card) and carries the ⋯ that opens that module's
     * settings — the card inside mounts headless, so it has no ⋯ of its own.
     */
    _applyLoneHeader(lone) {
      const btn = document.getElementById('float-module-settings');
      const only = lone && this.layout.columns[0] ? this.layout.columns[0].modules[0] : null;
      if (btn) btn.classList.toggle('hidden', !only);
      if (this._nameInput && document.activeElement !== this._nameInput) {
        this._nameInput.value = this._headerName();
      }
      if (!only) return;
      if (btn && !btn.dataset.wired) {
        btn.dataset.wired = '1';
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          const item = this.layout.columns[0] && this.layout.columns[0].modules[0];
          if (!item) return;
          const rect = btn.getBoundingClientRect();
          this.csp.openModuleSettings({
            moduleId: item.moduleId,
            instanceId: item.instanceId,
            anchor: {
              left: Math.round(window.screenX + rect.left),
              right: Math.round(window.screenX + rect.right),
              top: Math.round(window.screenY + rect.top),
            },
          });
        });
      }
    }

    /**
     * Move the window by its header. A lone module in a float is shown as a bare
     * card, so its header lifts the whole window — until the pointer reaches the
     * palette, where it turns back into a module drag so the destination can be
     * chosen (a new column, or a place in an existing one).
     */
    _beginWindowDrag(ev, mod, onOpen) {
      const startX = ev.screenX;
      const startY = ev.screenY;
      const label = mod.moduleId;
      let appliedX = 0;
      let appliedY = 0;
      let moved = false;
      let started = false;

      const move = (e) => {
        if (started) return;
        if (!moved) {
          if (Math.hypot(e.screenX - startX, e.screenY - startY) < 4) return;
          moved = true;
        }

        const outside = e.clientX < 0 || e.clientY < 0
          || e.clientX > window.innerWidth || e.clientY > window.innerHeight;
        if (outside) {
          started = true;

          try { ev.target.setPointerCapture(ev.pointerId); } catch {  }
          this.csp.dragBegin({ items: [mod.instanceId], text: label, width: Math.round(mod.el ? mod.el.offsetWidth : 0), height: Math.round(mod.el ? mod.el.offsetHeight : 0) });
          return;
        }
        const wantX = e.screenX - startX;
        const wantY = e.screenY - startY;
        const dx = wantX - appliedX;
        const dy = wantY - appliedY;
        if (dx || dy) {
          this.csp.moveSelfBy(dx, dy);
          appliedX = wantX;
          appliedY = wantY;
        }
      };
      const finish = (cancelled) => {
        try { ev.target.releasePointerCapture(ev.pointerId); } catch {  }
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        document.removeEventListener('keydown', onKey);
        ev.target.removeEventListener('lostpointercapture', onLost);
        document.body.classList.remove('drag-hidden');
        this._clearDropTarget();
        if (started) {
          if (cancelled) this.csp.dragCancel();
          else this.csp.dragDrop();
          started = false;
        } else if (!moved && onOpen && !cancelled) {
          this._suppressClick = Date.now() + 400;
          onOpen();
        }
      };
      const onUp = () => finish(false);
      const onCancel = () => finish(true);

      const onLost = () => finish(true);
      const onKey = (e) => {
        if (e.key === 'Escape') finish(true);
      };

      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
      document.addEventListener('keydown', onKey);
      ev.target.addEventListener('lostpointercapture', onLost);
    }

    /**
     * The column/index a point maps to (window-relative CSS pixels). A point in
     * the board's outer margin becomes a new column on that side.
     */
    _computeTarget(x, y, instanceId) {
      const rect = this.root.getBoundingClientRect();
      const EDGE = 30;
      if (x <= rect.left + EDGE) return { kind: 'edge', side: 'left' };
      if (x >= rect.right - EDGE) return { kind: 'edge', side: 'right' };
      let best = null;
      for (const entry of this.columns.values()) {
        const r = entry.el.getBoundingClientRect();
        if (x >= r.left && x <= r.right) { best = entry; break; }
      }
      if (!best) {
        let dist = Infinity;
        for (const entry of this.columns.values()) {
          const r = entry.el.getBoundingClientRect();
          const d = Math.abs(x - (r.left + r.right) / 2);
          if (d < dist) { dist = d; best = entry; }
        }
      }
      if (!best) return null;
      const index = this._indexAt(best, y, instanceId);
      const current = instanceId ? this.modules.get(instanceId) : null;
      const noop = Boolean(current && current.columnId === best.model.id && current.model
        && best.model.modules.indexOf(current.model) === index);
      return { kind: 'column', columnId: best.model.id, index, noop };
    }

    _indexAt(entry, y, instanceId) {
      const cards = [...entry.el.querySelectorAll('.module')].filter((c) => c.dataset.instance !== instanceId);
      let index = 0;
      for (const card of cards) {
        const r = card.getBoundingClientRect();
        if (y > r.top + r.height / 2) index += 1;
      }
      return index;
    }

    /**
     * Where a whole float would land: `{ kind: 'divider', index }` on the seam
     * between two columns (or the outer edges) — insert its columns there — or
     * `{ kind: 'column', columnId, index }` on a column body — merge its
     * modules into that column. Window-local CSS pixels.
     */    _setDropIndicator(target) {
      this._clearIndicator();
      if (!target) return;
      if (target.kind === 'edge') {
        const edge = document.createElement('div');
        edge.className = `drop-edge drop-edge-${target.side}`;
        this.root.append(edge);
        this._indicator = edge;
        return;
      }
      if (target.kind === 'divider') {

        this._drawDivider(target.index);
        return;
      }
      const entry = this.columns.get(target.columnId);
      if (!entry) return;
      if (target.noop) {

        const dragged = this.modules.get(this._dragInstance);
        if (dragged) {
          dragged.el.classList.add('drop-same');
          this._sameCard = dragged.el;
        }
        return;
      }
      const cards = [...entry.el.querySelectorAll('.module')]
        .filter((card) => card.dataset.instance !== this._dragInstance);
      const colTop = entry.el.getBoundingClientRect().top;
      let top = 2;
      if (cards.length) {
        if (target.index <= 0) {
          top = cards[0].getBoundingClientRect().top - colTop;
        } else if (target.index >= cards.length) {
          top = cards[cards.length - 1].getBoundingClientRect().bottom - colTop;
        } else {
          top = (cards[target.index - 1].getBoundingClientRect().bottom
            + cards[target.index].getBoundingClientRect().top) / 2 - colTop;
        }
      }

      const line = document.createElement('div');
      line.className = 'drop-line';
      const lineH = 4;
      const maxTop = Math.max(0, entry.el.clientHeight - lineH);
      const topPx = Math.max(0, Math.min(Math.round(top) - lineH / 2, maxTop));
      line.style.top = `${topPx}px`;
      entry.el.append(line);
      this._indicator = line;
    }

    _clearIndicator() {
      if (this._dropBox) {
        this._dropBox.classList.remove('drop-box');
        this._dropBox = null;
      }
      if (this._sameCard) {
        this._sameCard.classList.remove('drop-same');
        this._sameCard = null;
      }
      if (this._indicator) {
        this._indicator.remove();
        this._indicator = null;
      }
    }

    /** A vertical line at the seam between columns (a whole-float drop). */
    _drawDivider(index) {
      const cols = [...this.columns.values()];
      let x = 0;
      if (index <= 0) x = 0;
      else if (index >= cols.length) x = this.root.clientWidth;
      else {
        const a = cols[index - 1].el.getBoundingClientRect();
        const b = cols[index].el.getBoundingClientRect();
        x = (a.right + b.left) / 2 - this.root.getBoundingClientRect().left;
      }
      const line = document.createElement('div');
      line.className = 'drop-divider';
      line.style.left = `${Math.max(0, Math.round(x) - 2)}px`;
      this.root.append(line);
      this._indicator = line;
    }

    /**
     * The indicator for a whole float hovering this board: a box around the
     * column it would merge into, or a line on the seam it would be inserted at.
     */
  _clearDropTarget() {
      this._clearIndicator();
      this._dropTarget = null;
      this._dropKey = null;
    }

    _nextColumnId() {
      let n = this.layout.columns.length + 1;
      let id = `c${n}`;
      while (this.layout.columns.some((c) => c.id === id)) { n += 1; id = `c${n}`; }
      return id;
    }

    /** Grow (or shrink) this board's window by a number of CSS pixels. */
    _nudgeWindowWidth(delta) {
      const min = this.minWindowSize();
      const width = Math.max(min.width, Math.round(window.innerWidth + delta));
      this._applyWindowSize(width, Math.round(window.innerHeight));
    }

    /** Resize this board's window, muting `_enforceWindowMin` until it lands. */
    _applyWindowSize(width, height) {
      this._resizeGraceUntil = Date.now() + 150;
      this._appliedW = width;
      this._appliedH = height;
      this._resize(width, height);

      clearTimeout(this._reconcileTimer);
      this._reconcileTimer = setTimeout(() => this._reconcile(), 200);
    }

    /** The instances this board has selected, in document order. */
    selection() {
      return [...this._selection];
    }

    /** Set the selection outright (the --select flag, or a shift-click's result). */
    select(instanceIds) {
      const wanted = new Set(Array.isArray(instanceIds) ? instanceIds : [instanceIds]);
      const order = this._documentOrder();
      this._selection = order.filter((id) => wanted.has(id));
      this._selAnchor = this._selection.length ? this._selection[this._selection.length - 1] : null;
      this._paintSelection();
      return this._selection;
    }

    _documentOrder() {

      return window.IroLayoutModel
        ? window.IroLayoutModel.documentOrder(this.layout, this._paletteId)
        : [...this.modules.keys()];
    }

    _paintSelection() {
      for (const [instanceId, entry] of this.modules) {
        entry.el.classList.toggle('selected', this._selection.includes(instanceId));
      }
    }

    /**
     * What a press means. Shift extends from the anchor over the *document order*,
     * Ctrl/Cmd toggles one, and a plain press keeps an existing multi-selection —
     * which is how a selection is dragged as one payload (docs/LAYOUT.md, V4).
     */
    _selectionFor(ev, instanceId) {
      const order = this._documentOrder();
      if (ev.shiftKey) {
        const anchor = this._selAnchor && order.includes(this._selAnchor) ? this._selAnchor : instanceId;
        const range = window.IroLayoutModel
          ? window.IroLayoutModel.rangeBetween(order, anchor, instanceId)
          : [instanceId];
        return { ids: range.length ? range : [instanceId], anchor };
      }
      if (ev.ctrlKey || ev.metaKey) {
        const has = this._selection.includes(instanceId);
        return {
          ids: has ? this._selection.filter((id) => id !== instanceId) : [...this._selection, instanceId],
          anchor: instanceId,
        };
      }
      return { ids: this._selection.includes(instanceId) ? [...this._selection] : [instanceId], anchor: instanceId };
    }

    /**
     * Programmatic drop (used by the --board-drag shot flag): straight to the same
     * intent the drag session dispatches, so there is one path into the document.
     */
    dragTo(instanceId, spec) {
      const [col, indexStr] = String(spec).split(':');
      let target;
      if (col === 'left' || col === 'right') {
        target = { kind: 'outer', side: col };
      } else {
        const entry = this.columns.get(col);
        if (!entry) return false;
        target = {
          kind: 'column',
          columnId: col,
          index: indexStr === undefined ? entry.model.modules.length : Number(indexStr),
        };
      }
      if (!this.csp || typeof this.csp.dragPlace !== 'function') return false;

      const card = this.modules.get(instanceId);
      const width = card && card.el ? Math.round(card.el.offsetWidth) : null;
      return this._place({ items: [instanceId], target, width });
    }

    /** One place for the refusal to be visible rather than silent. */
    _place(payload) {
      return this.csp.dragPlace(payload)
        .then((res) => {
          if (res && res.ok === false) console.warn('dragPlace refused:', res.error, JSON.stringify(payload.target));
          return res;
        })
        .catch((err) => {
          console.warn('dragPlace failed:', err && err.message);
          return { ok: false };
        });
    }

    _makePlaceholder() {
      const el = document.createElement('div');
      el.className = 'column-empty';
      el.textContent = window.Iro.t('ui.layout.dropHere');
      return el;
    }

    addColumn() {
      this._materializeColumnWidths();
      const count = this.layout.columns.length + 1;
      const share = Math.max(MIN_COLUMN, Math.round((this.root.clientWidth || 0) / count));
      this.layout.columns.push({ id: this._nextColumnId(), width: share, modules: [] });
      this.render();
      this._save();
    }

    /**
     * Give every column a concrete width. A column with no width only makes
     * sense while it is alone (it then fills the board); as soon as there is a
     * second column the widths are the proportions they share.
     */
    _materializeColumnWidths() {
      const count = this.layout.columns.length || 1;
      const share = Math.max(MIN_COLUMN, Math.round((this.root.clientWidth || 0) / count));
      for (const col of this.layout.columns) {
        if (col.width == null) col.width = share;
      }
    }

    moveModule(instanceId, targetColumnId) {

      const entry = this.modules.get(instanceId);
      const to = this.columns.get(targetColumnId);
      if (!entry || !to) return;
      const index = to.model.modules.length;
      if (entry.columnId === targetColumnId && to.model.modules.indexOf(entry.model) === index - 1) return;
      if (!this.csp || typeof this.csp.dragPlace !== 'function') return;
      this._place({ items: [instanceId], target: { kind: 'column', columnId: targetColumnId, index } });
    }

    _moduleAction(payload) {
      if (!payload) return;
      if (payload.action === 'move' && payload.columnId) {
        this.moveModule(payload.instanceId, payload.columnId);
      } else if (payload.action === 'float') {
        this.floatModule(payload.instanceId);
      }
    }

    /** Lift a module off the board into its own window. */
    async floatModule(instanceId) {
      const entry = this.modules.get(instanceId);
      if (!entry) return;

      await this._place({ items: [instanceId], target: { kind: 'desktop' } });
    }

    /** Dock one module of this float back to the palette. */
    async dockModuleOut(mod) {
      try {
        this.csp.floatDock({ floatId: this.floatId, moduleId: mod.moduleId, instanceId: mod.instanceId });
      } catch {  }
      const entry = this.modules.get(mod.instanceId);
      const from = entry && this.columns.get(entry.columnId);
      if (from) from.model.modules = from.model.modules.filter((m) => m.instanceId !== mod.instanceId);
      this.layout.columns = this.layout.columns.filter((col) => col.modules.length > 0);
      if (!this.layout.columns.length) {
        this.layout.columns.push({ id: this._nextColumnId(), width: null, modules: [] });
      }
      await this.render();
      this._save();
    }

    /** Resize a column or a module by px (the dev flag `--board-size`). */
    resize(id, px) {
      const column = this.columns.get(id);
      if (column) {

        const minW = this._columnMinWidth(column.model);
        column.model.width = Math.max(minW, Math.round(px));
        this._applyColumnWidth(column.el, column.model);
        for (const mod of column.model.modules) {
          this._applyModuleUnit({ model: mod, el: column.el }, { width: column.el.offsetWidth });
        }
        this._save();
        return true;
      }
      const mod = this.modules.get(id);
      if (mod) {
        const colEntry = [...this.columns.values()].find((c) => c.el === mod.el.parentElement);
        const colModel = colEntry && colEntry.model;

        if (this._ratioOf(mod.model)) {
          const width = Math.max(1, mod.el.offsetWidth);
          const LM = window.IroLayoutModel;
          const ratio = LM && typeof LM.ratioFromDrag === 'function'
            ? LM.ratioFromDrag(px, width, this._minHeightOf(mod.model))
            : clamp(px / width, 0.05, 2.5);
          if (ratio === null) return false;
          mod.model.ratio = ratio;
          mod.model.weight = null;
          this._applyModuleWeight(mod.el, mod.model, this._moduleWeightOpts(colModel, mod.model));
          this._save();
          return true;
        }

        if (this._isUnitSized(mod.model)) {
          this._applyModuleUnit(mod, { height: Math.max(1, Math.round(px)) });
          return true;
        }
        mod.model.weight = Math.max(1, Math.round(px));
        this._applyModuleWeight(mod.el, mod.model, this._moduleWeightOpts(colModel, mod.model));
        this._save();
        return true;
      }
      return false;
    }

    /**
     * Re-apply the sizes (a module's minimum may have changed, e.g. the slider
     * turned vertical) without rebuilding the board.
     */
    refreshSizes() {
      for (const entry of this.columns.values()) {
        this._applyColumnWidth(entry.el, entry.model);
      }
      for (const entry of this.modules.values()) {
        const col = this.columns.get(entry.columnId);
        this._applyModuleWeight(entry.el, entry.model, this._moduleWeightOpts(col && col.model, entry.model));
      }
      this._enforceWindowMin();
    }

    /**
     * What this board actually drew, in window-local CSS pixels. The drop
     * resolver prefers this over re-computing from the document, because the model
     * and the render can drift (docs/LAYOUT.md, V4).
     */
    boardMetrics() {
      const columns = [];
      for (const col of this.root.querySelectorAll('.column')) {
        const cr = col.getBoundingClientRect();
        const modules = [];
        for (const m of col.querySelectorAll('.module')) {
          const mr = m.getBoundingClientRect();
          modules.push({ instanceId: m.dataset.instance, top: Math.round(mr.top), height: Math.round(mr.height) });
        }
        columns.push({
          columnId: col.dataset.column,
          left: Math.round(cr.left),
          width: Math.round(cr.width),
          modules,
        });
      }
      return {
        pad: BOARD_PAD,

        minWidth: this.minWindowSize().width,
        minHeight: this.minWindowSize().height,
        boxes: { columns },
      };
    }

    /** Coalesced: a board re-lays out far more often than main needs to hear. */
    _reportMetrics() {
      if (this._metricsTimer) return;
      this._metricsTimer = setTimeout(() => {
        this._metricsTimer = null;
        if (!this.csp || typeof this.csp.boardMetrics !== 'function') return;
        try {
          this.csp.boardMetrics(this.boardMetrics());
        } catch {  }
      }, 80);
    }

    _save() {
      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => {
        this._saveTimer = null;
        try {
          Promise.resolve(this._persist(this.getLayout())).catch(() => {});
        } catch {  }
      }, 250);
    }
  }

  window.Iro = window.Iro || {};
  window.Iro.Board = Board;
})();

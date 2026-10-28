/*
 * The shortcut settings shape, in one place.
 *
 * `settings.json#shortcuts` is deliberately small: for the whole app and for
 * each palette, a show/hide chord, a hold chord, an after-colour-pick switch,
 * and the appearance position. Module command bindings stay in
 * `settings.json#commandBindings` (keyed by instance and command, not palette).
 *
 * This module is pure and shared so main (registration, conflict checks,
 * pruning) and the Settings window (rendering, capture) cannot disagree about
 * what a binding is called. It loads as CommonJS in Node and as a global
 * `IroShortcutModel` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shortcut-match'));
  else root.IroShortcutModel = factory(root.IroShortcutMatch);
})(typeof self !== 'undefined' ? self : this, function (Match) {
  'use strict';

  const str = (value) => (typeof value === 'string' ? value.trim() : '');
  const norm = (accel) => (Match ? Match.normalizeAccel(accel) : str(accel));

  /** A fresh settings block (never shared between callers). */
  function defaults() {
    return {
      app: { mode: 'toggle', toggle: '', hold: '', autoDismiss: false, position: 'keep' },
      palettes: {},
    };
  }

  const POSITIONS = ['keep', 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const MODES = ['toggle', 'hold', 'afterPick'];
  const positionOf = (value) => (POSITIONS.includes(value) ? value : 'keep');
  const targetMode = (value, raw) => {
    if (MODES.includes(value)) return value;
    // Migration: the old fields allowed several methods at once. Pick the one the
    // user most likely meant, while keeping the saved keys for when they switch.
    if (raw && typeof raw.afterPick === 'boolean') {
      if (raw.afterPick) return 'afterPick';
      const oldToggle = typeof raw.toggle === 'string' ? raw.toggle.trim() : '';
      const oldHold = typeof raw.hold === 'string' ? raw.hold.trim() : '';
      return oldHold && !oldToggle ? 'hold' : 'toggle';
    }
    if (raw && raw.legacyAfterPick === true) return 'afterPick';
    const toggle = typeof raw?.toggle === 'string' ? raw.toggle.trim() : '';
    const hold = typeof raw?.hold === 'string' ? raw.hold.trim() : '';
    if (hold && !toggle) return 'hold';
    return 'toggle';
  };

  /**
   * Repair anything a settings file (or an older build) might contain.
   *
   * One mode per target is the model now. Old files could enable toggle, hold and
   * after-pick together; `targetMode` chooses one and keeps the other accelerators
   * so switching back later restores them.
   */
  function normalise(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = defaults();
    const legacyAlt = typeof src.altClick === 'string' ? src.altClick.trim() : null;
    if (src.app && typeof src.app === 'object') {
      const legacy = { ...src.app, legacyAfterPick: legacyAlt === 'app' };
      out.app.mode = targetMode(src.app.mode, legacy);
      out.app.toggle = str(src.app.toggle);
      out.app.hold = str(src.app.hold);
      out.app.autoDismiss = src.app.autoDismiss === true;
      out.app.position = positionOf(src.app.position);
    } else if (legacyAlt === 'app') {
      out.app.mode = 'afterPick';
    }
    const palettes = src.palettes && typeof src.palettes === 'object' ? src.palettes : {};
    for (const [id, value] of Object.entries(palettes)) {
      const key = str(id);
      if (!key || !value || typeof value !== 'object') continue;
      const legacy = { ...value, legacyAfterPick: legacyAlt === `palette:${key}` };
      out.palettes[key] = {
        mode: targetMode(value.mode, legacy),
        toggle: str(value.toggle),
        hold: str(value.hold),
        autoDismiss: value.autoDismiss === true,
        position: positionOf(value.position),
      };
    }
    return out;
  }

  /** `{ kind: 'app' }` or `{ kind: 'palette', paletteId }`; null for malformed. */
  function parseTarget(target) {
    if (target === 'app' || target === '' || target == null) return { kind: 'app' };
    const match = /^palette:(.+)$/.exec(String(target));
    if (match) return { kind: 'palette', paletteId: match[1] };
    return null;
  }

  const appKey = () => 'app';
  const paletteKey = (paletteId) => `palette:${paletteId}`;
  const targetKey = (target) => {
    if (target && typeof target === 'object') {
      if (target.kind === 'palette' && target.paletteId) return paletteKey(target.paletteId);
      return 'app';
    }
    const parsed = parseTarget(target);
    if (!parsed) return 'app';
    return parsed.kind === 'palette' ? paletteKey(parsed.paletteId) : 'app';
  };

  /** The shortcut fields for one target, or null when the target is malformed. */
  function targetShortcuts(shortcuts, target) {
    const parsed = typeof target === 'string' ? parseTarget(target) : target;
    if (!parsed) return null;
    const s = normalise(shortcuts);
    if (parsed.kind === 'app') return s.app;
    return s.palettes[parsed.paletteId]
      || { mode: 'toggle', toggle: '', hold: '', autoDismiss: false, position: 'keep' };
  }

  /**
   * Every accelerator Iroiroppa owns, in registration order. `key` is stable and
   * unique (`app:toggle`, `palette:p1:hold`, `command:<instance>:<command>`), so a
   * caller can roll one back without rebuilding the whole map.
   */
  function bindings(shortcuts, commandBindings) {
    const s = normalise(shortcuts);
    const out = [];
    const add = (key, target, action, accel) => {
      const value = norm(accel);
      if (value) out.push({ key, target, action, accel: value });
    };
    const addTarget = (base, target, pair) => {
      if (pair.mode === 'toggle') add(`${base}:toggle`, target, 'toggle', pair.toggle);
      else if (pair.mode === 'hold') add(`${base}:hold`, target, 'hold', pair.hold);
    };
    addTarget('app', 'app', s.app);
    for (const [id, pair] of Object.entries(s.palettes)) {
      addTarget(`palette:${id}`, paletteKey(id), pair);
    }
    for (const [key, accel] of Object.entries(commandBindings || {})) {
      add(`command:${key}`, null, 'command', accel);
    }
    return out;
  }

  /**
   * The binding already using `accel`, ignoring `exceptKey`, or null. The caller
   * can then say which surface owns it instead of only "taken".
   */
  function findConflict(accel, shortcuts, commandBindings, exceptKey) {
    const wanted = norm(accel);
    if (!wanted) return null;
    return bindings(shortcuts, commandBindings)
      .find((entry) => entry.key !== exceptKey && entry.accel === wanted) || null;
  }

  /**
   * Drop shortcuts for palettes that no longer exist. Returns
   * `{ shortcuts, changed }`.
   */
  function prune(raw, paletteIds) {
    const s = normalise(raw);
    const live = new Set(Array.isArray(paletteIds) ? paletteIds.map(String) : []);
    let changed = false;
    for (const id of Object.keys(s.palettes)) {
      if (!live.has(id)) {
        delete s.palettes[id];
        changed = true;
      }
    }
    return { shortcuts: s, changed };
  }

  /** Short, human labels for a conflict message (English; the UI can re-label). */
  function bindingLabel(entry) {
    if (!entry) return '';
    if (entry.action === 'command') return entry.key.replace(/^command:/, '');
    if (entry.target === 'app') return `Iroiroppa ${entry.action === 'hold' ? 'hold' : 'show/hide'}`;
    const parsed = parseTarget(entry.target);
    return parsed && parsed.kind === 'palette'
      ? `${parsed.paletteId} ${entry.action === 'hold' ? 'hold' : 'show/hide'}`
      : entry.action;
  }

  return {
    defaults,
    normalise,
    parseTarget,
    targetKey,
    targetShortcuts,
    bindings,
    findConflict,
    // Hold is momentary and can coexist with Auto-hide; kept for old callers.
    holdAllowed: () => true,
    POSITIONS,
    MODES,
    prune,
    bindingLabel,
    normaliseAccel: norm,
  };
});

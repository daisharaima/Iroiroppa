
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroModuleManifest = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Manifest order is mount order (keep it alphabetical so `ids()` is stable).
   * - `autoHeight` — the module sizes to its content instead of taking a
   *   proportional share of its column. Must match the module's own
   *   registration.
   * - `instanceable: false` — a singleton: at most one instance in the whole
   *   workspace (the reducer refuses a second one). Instanceable modules may be
   *   mounted many times, each with its own settings (docs/LAYOUT.md, N1).
   * - `group` — the Modules tab section it lists under: `core` (the control and
   *   connection), `picker` (the colour selectors), `utility`.
   * - `defaultRatio` — the module's locked height:width ratio (height = column
   *   width x ratio; docs/LAYOUT.md, "Locked-ratio sizing"). It takes precedence
   *   over `autoHeight`; a module without one sizes to its content (`autoHeight`)
   *   or a column share.
   */
  const MODULES = [
    { id: 'color-disc', name: 'Color Disc', autoHeight: true, instanceable: true, group: 'picker' },
    { id: 'color-history', name: 'Color History', autoHeight: false, instanceable: true, group: 'utility', defaultRatio: 0.36 },
    { id: 'color-slices', name: 'Color Slices', autoHeight: false, instanceable: true, group: 'picker', defaultRatio: 1.0 },
    { id: 'color-slider', name: 'Color Slider', autoHeight: false, instanceable: true, group: 'picker', defaultRatio: 0.36 },

    { id: 'color-stat', name: 'Color Stat', autoHeight: true, instanceable: true, group: 'utility' },

    { id: 'color-wheel', name: 'Color Wheel', autoHeight: false, instanceable: true, group: 'picker', defaultRatio: 0.9 },
    { id: 'csp-color', name: 'CSP Color', autoHeight: false, instanceable: false, group: 'core', defaultRatio: 0.12, capabilities: { companion: 'optional' } },

    { id: 'csp-shortcuts', name: 'Shortcut Library', autoHeight: false, instanceable: true, group: 'utility', defaultRatio: 0.9, capabilities: { companion: 'optional', sender: 'optional' } },

    { id: 'session', name: 'Session', autoHeight: true, instanceable: false, group: 'core', capabilities: { companion: 'optional' } },
  ];

  /** The modules of the first-run board, in board order (top to bottom). */
  const DEFAULT_IDS = [
    'session', 'csp-color', 'color-wheel', 'color-slices',
    'color-slider', 'color-history', 'color-stat',
  ];


  const userModules = [];
  const all = () => MODULES.concat(userModules);

  /** Register user-module metadata (idempotent; first registration of an id wins). */
  function register(entries) {
    for (const e of entries || []) {
      if (!e || !e.id || get(e.id)) continue;
      userModules.push({
        id: e.id,
        name: e.name || e.id,
        autoHeight: e.autoHeight === true,
        instanceable: e.instanceable !== false,
        group: e.group || 'utility',
        defaultRatio: Number.isFinite(e.defaultRatio) && e.defaultRatio > 0 ? e.defaultRatio : null,
        capabilities: e.capabilities && typeof e.capabilities === 'object' ? { ...e.capabilities } : null,
        user: true,
      });
    }
  }

  const ids = () => all().map((m) => m.id);

  const get = (id) => all().find((m) => m.id === id) || null;

  const has = (id) => get(id) !== null;

  /** The `{ moduleId: def }` registry the layout model and the store expect. */
  function registry() {
    const out = {};
    for (const m of all()) out[m.id] = { ...m };
    return out;
  }

  /** The first-run board's modules, filtered to the ones that still exist. */
  const defaultIds = () => DEFAULT_IDS.filter(has);

  const isSingleton = (id) => {
    const def = get(id);
    return Boolean(def && def.instanceable === false);
  };

  return {
    MODULES,
    DEFAULT_IDS,
    MODULE_IDS: ids(),
    ids,
    get,
    has,
    registry,
    defaultIds,
    isSingleton,
    register,
  };
});

/*
 * The one list of selector modules.
 *
 * Main needs module metadata without loading module code (which only exists in
 * the renderer), the renderer needs to know what to mount, and the layout model
 * needs a registry so it can tell an unknown module from a known one. This is
 * that single list — so a module's id, its name and whether it is `autoHeight`
 * cannot drift between the three.
 *
 * `test/docs.test.js` checks every entry against the module files on disk (and
 * back), so adding a module without registering it here fails `npm test`.
 *
 * Loads as CommonJS in Node and as a global `IroModuleManifest` in the renderer.
 */
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
    { id: 'color-slices', name: 'Color Slices', autoHeight: false, instanceable: true, group: 'picker', defaultRatio: 1.42 },
    { id: 'color-slider', name: 'Color Slider', autoHeight: false, instanceable: true, group: 'picker', defaultRatio: 0.33 },
    // The numbers of the colour in hand: the footer's swatch, HEX and coordinates, as a module
    // any palette can hold (docs/LAYOUT.md, "One palette").
    { id: 'color-stat', name: 'Color Stat', autoHeight: true, instanceable: true, group: 'utility' },
    // The hue ring and its inner hue slice (flat or the cusp frame): a fast way
    // to turn hue without hunting the slices' hue axis.
    { id: 'color-wheel', name: 'Color Wheel', autoHeight: false, instanceable: true, group: 'picker', defaultRatio: 1.06 },
    { id: 'csp-color', name: 'CSP Color', autoHeight: false, instanceable: false, group: 'core', defaultRatio: 0.12, capabilities: { companion: 'optional' } },
    // CSP's own command shortcuts and tool keys, read from its SQLite files and
    // invoked over the protocol or a native key send.
    { id: 'csp-shortcuts', name: 'CSP Shortcuts', autoHeight: false, instanceable: true, group: 'utility', defaultRatio: 0.9, capabilities: { companion: 'optional', sender: 'optional' } },
    // The app's own control panel — the only singleton that is *worth* mounting in a palette,
    // and the home of the connection state, the profile switcher and the Settings entry
    // (docs/LAYOUT.md, "One palette").
    { id: 'session', name: 'Session', autoHeight: true, instanceable: false, group: 'core', capabilities: { companion: 'optional' } },
  ];

  /** The modules of the first-run board, in board order (top to bottom). */
  const DEFAULT_IDS = ['session', 'csp-color', 'color-stat', 'color-slices', 'color-slider'];

  // User modules (docs/USER-MODULES.md) are loaded by main from
  // %APPDATA%\Iroiroppa\user-modules and registered here at boot, after the
  // bundled list. They carry `user: true` so the loader resolves their script
  // over `module://`. A bundled id always wins; a user module may not shadow one.
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

/*
 * How many instances of a module exist, and how many are visible.
 *
 * A hidden instance still exists (it keeps its settings and can be restored), but
 * it is mounted nowhere. The Settings → Modules light is an indicator of *visible*
 * instances: green when at least one is on screen, grey when all are hidden or none
 * exists. Pure, so the rule is testable without a DOM or Electron.
 *
 * Loads as CommonJS in Node and as a global `IroModuleUsage` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroModuleUsage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function moduleUsage(id, doc = {}) {
    let visible = 0;
    const visit = (columns) => {
      for (const col of columns || []) {
        for (const m of col.modules || []) {
          if (m && m.moduleId === id && m.instanceId) visible += 1;
        }
      }
    };
    visit(doc.columns);
    for (const f of doc.floats || []) visit(f && f.columns);
    const hidden = (doc.hiddenInstances || []).filter((h) => h && h.moduleId === id).length;
    return { visible, hidden, total: visible + hidden, enabled: visible > 0 };
  }

  return { moduleUsage };
});

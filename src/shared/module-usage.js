
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

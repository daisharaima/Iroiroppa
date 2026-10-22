'use strict';

// The IPC handler helpers shared across the group files (docs/STATE.md).
//
// Moved out of ipc.js verbatim. `wireIpc` builds one with `createHelpers(ctx,
// trusted)` and hands it to each group's `register(ctx, h)`, which destructures
// what it needs. Keeping the helper bodies in one place is what lets the group
// handlers stay small and move without carrying closures around.

function createHelpers(ctx, trusted) {
  const instanceOf = (spec) => (spec && typeof spec.instanceId === 'string' ? spec.instanceId : null);

  /** Where an instance is: placed in a palette, or hidden (kept, mounted nowhere). */
  const findInstance = (instanceId) => {
    const doc = ctx.currentWorkspace();
    for (const palette of doc.palettes || []) {
      for (const column of palette.columns || []) {
        for (const m of column.modules || []) {
          if (m.instanceId === instanceId) return { moduleId: m.moduleId, paletteId: palette.id, hidden: false };
        }
      }
    }
    for (const h of doc.hiddenInstances || []) {
      if (h.instanceId === instanceId) return { moduleId: h.moduleId, paletteId: null, hidden: true };
    }
    return null;
  };

  /** Which module does this instance belong to — placed in a palette, in a float, or hidden? */
  function moduleIdOfInstance(instanceId) {
    if (!instanceId) return null;
    const doc = ctx.readLayoutDoc();
    for (const hidden of (doc && doc.hiddenInstances) || []) {
      if (hidden && (hidden.instanceId === instanceId || hidden.id === instanceId)) return hidden.moduleId || null;
    }
    const columns = [];
    for (const col of (doc && doc.columns) || []) columns.push(col);
    for (const floatDoc of (doc && doc.floats) || []) for (const col of floatDoc.columns || []) columns.push(col);
    for (const col of columns) {
      const found = (col.modules || []).find((m) => m.instanceId === instanceId);
      if (found) return found.moduleId || null;
    }
    return null;
  }

  /** Is this module one that may exist only once (and therefore may never be deleted)? */
  function isSingletonModule(moduleId) {
    try {
      const { isSingleton } = require('../../shared/module-manifest');
      return Boolean(moduleId) && isSingleton(moduleId);
    } catch { return false; }
  }

  /** Which palette owns the window that sent this? The palette is the primary
   *  one; a float is the palette whose id is its window key. */
  function paletteIdForSender(sender) {
    if (ctx.popup && !ctx.popup.isDestroyed() && ctx.popup.webContents === sender) return ctx.primaryPaletteId();
    for (const [floatId, win] of ctx.floatWins) {
      if (!win.isDestroyed() && win.webContents === sender) return floatId;
    }
    return null;
  }

  // Settings are owned by src/main/settings-service.js; the IPC layer only asks
  // that service to commit.
  const commitSettings = (merged) => ctx.settings.commit(merged);

  return { instanceOf, findInstance, moduleIdOfInstance, isSingletonModule, paletteIdForSender, commitSettings, trusted };
}

module.exports = { createHelpers };

'use strict';

// Owns settings.json (docs/ARCHITECTURE.md).
//
// The IPC layer asks this service to commit a change; the service persists it
// (atomically, via JsonStore) and runs the side effects. Keeping the effects here
// — not in an IPC handler — is what makes "settings has exactly one owner" true.
//
// `hooks` is the app context: the side-effect functions it already exposes
// (broadcast, normalizeTheme, applyLocked, …). The read/write API
// (`get`/`set`/`replace`/`clear`) is identical to the raw store, so every existing
// caller is unchanged.

const { JsonStore } = require('./store');

function createSettingsService({ file, defaults = {}, hooks = {} } = {}) {
  const store = new JsonStore(file, defaults);

  /** Merge a settings patch (or an imported file), run the side effects, broadcast. */
  function commit(merged) {
    const prev = store.get();
    const clean = { ...merged };
    if (clean.theme) clean.theme = hooks.normalizeTheme(clean.theme);
    // Keep a short most-recently-used list of proof profiles.
    if (clean.proofProfile && clean.proofProfile !== prev.proofProfile) {
      clean.proofProfiles = [
        clean.proofProfile,
        ...(prev.proofProfiles || []).filter((p) => p !== clean.proofProfile),
      ].slice(0, 8);
    }
    const next = store.set(clean);
    if (prev.autoHide !== next.autoHide) {
      if (next.autoHide) hooks.startFollowFocus();
      else if (typeof hooks.applyAutoHide === 'function') hooks.applyAutoHide(false);
      else hooks.stopFollowFocus();
    }
    if (prev.autoConnect !== next.autoConnect) hooks.scheduleAutoConnect();
    if (prev.locked !== next.locked) hooks.applyLocked(next.locked === true);
    if (JSON.stringify(prev.shortcuts || {}) !== JSON.stringify(next.shortcuts || {})
      || prev.autoHide !== next.autoHide) {
      if (typeof hooks.applyShortcuts === 'function') hooks.applyShortcuts(next);
    }
    if (JSON.stringify(prev.commandBindings || {}) !== JSON.stringify(next.commandBindings || {})) {
      hooks.applyCommandHotkeys(next.commandBindings);
    }
    if (prev.proofProfile !== next.proofProfile) {
      hooks.clearProofCaches();
    }
    if (prev.launchAtLogin !== next.launchAtLogin) hooks.applyLaunchAtLogin(next.launchAtLogin);
    if (prev.uiScale !== next.uiScale) hooks.applyUiScale();
    if (prev.theme !== next.theme) hooks.applyWindowTheme();
    if (prev.language !== next.language) hooks.applyLanguage(next.language);
    if (prev.historyGate !== next.historyGate) hooks.applyHistoryGate(next.historyGate === true);
    hooks.broadcast('settings:changed', next);
    return next;
  }

  return {
    get: () => store.get(),
    set: (patch) => store.set(patch),
    replace: (value) => store.replace(value),
    clear: () => store.clear(),
    commit,
  };
}

module.exports = { createSettingsService };

'use strict';

// Owns the three ways a General/Palette target can be revealed:
//
//   toggle    — a key that latches the target shown/hidden;
//   hold      — a momentary key (press/release), because globalShortcut has no
//               key-up; `keys.ps1` supplies it;
//   afterPick — Alt+left on the CSP canvas reveals the target, and the next
//               drawing stroke (or an 8 s fallback) hides only the windows that
//               pick opened.
//
// The state machine is here, not split between the window layer and the renderer,
// so the conflict rules have one owner. Everything window-shaped is injected
// through `ctx`, which keeps this testable without Electron.
//
// Priorities:
//   explicit Toggle/Hold > After-pick;
//   Hold restores a snapshot, it does not overwrite it;
//   After-pick only hides windows it actually opened.

const ShortcutModel = require('../shared/shortcut-model');
const Match = require('../shared/shortcut-match');
const { KeyHoldWatcher, checkHoldAccel } = require('./key-hold');
const { BareKeyWatcher } = require('./bare-key');

const ACTIONS = new Set(['toggle', 'hold']);
const AFTER_PICK_MS = 8000;

function targetKey(target, action) {
  const parsed = ShortcutModel.parseTarget(target);
  if (!parsed) return '';
  const base = parsed.kind === 'palette' ? `palette:${parsed.paletteId}` : 'app';
  return `${base}:${action}`;
}

function patch(shortcuts, target, action, accel) {
  const next = ShortcutModel.normalise(shortcuts);
  const parsed = ShortcutModel.parseTarget(target);
  if (!parsed) return next;
  if (parsed.kind === 'app') next.app[action] = accel;
  else {
    const current = next.palettes[parsed.paletteId]
      || { mode: 'toggle', toggle: '', hold: '', autoDismiss: false, position: 'keep' };
    next.palettes[parsed.paletteId] = { ...current, [action]: accel };
  }
  return next;
}

function createShortcutActions(ctx, deps = {}) {
  const globalShortcut = deps.globalShortcut || require('electron').globalShortcut;
  const HoldWatcher = deps.HoldWatcher || KeyHoldWatcher;
  const BareWatcher = deps.BareWatcher || BareKeyWatcher;
  const checkHold = deps.checkHold || checkHoldAccel;
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;
  let toggles = new Map(); // key -> accelerator
  let holds = new Map(); // key -> KeyHoldWatcher
  let activeHold = null; // { key, target, snapshot }
  let afterPick = null; // { shown: Set<paletteId>, timer }
  let dismiss = null; // { target } — Toggle mode's auto-dismiss after CSP interaction
  let bareWatchers = new Map(); // key -> BareKeyWatcher
  let bareActive = true;
  let bareTyping = false;
  let failures = [];

  const settingsNow = () => ctx.settings.get();
  const shortcutsNow = () => ShortcutModel.normalise(settingsNow().shortcuts);

  function targetPalettes(target) {
    const parsed = ShortcutModel.parseTarget(target) || { kind: 'app' };
    return parsed.kind === 'palette' ? [parsed.paletteId] : ctx.paletteIds();
  }

  function isVisible(id) {
    return typeof ctx.paletteVisible === 'function' ? ctx.paletteVisible(id) : false;
  }

  function positionOf(target) {
    const parsed = ShortcutModel.parseTarget(target);
    if (!parsed) return 'keep';
    return ShortcutModel.targetShortcuts(shortcutsNow(), target).position || 'keep';
  }

  function place(id, mode) {
    if (!id || !mode || mode === 'keep') return;
    if (typeof ctx.positionShortcutWindow === 'function') ctx.positionShortcutWindow(id, mode);
  }

  // --- after-pick -----------------------------------------------------------

  function clearAfterPickTimer() {
    if (afterPick && afterPick.timer) clearTimer(afterPick.timer);
    if (afterPick) afterPick.timer = null;
  }

  /** Hide only the windows this after-pick actually opened; never touch suppression. */
  function endAfterPick() {
    if (!afterPick) return false;
    if (afterPick.timer) clearTimer(afterPick.timer);
    const shown = [...afterPick.shown];
    afterPick = null;
    for (const id of shown) {
      if (!isVisible(id)) continue;
      if (typeof ctx.hidePaletteWindow === 'function') {
        ctx.hidePaletteWindow(id, { suppress: false });
      }
    }
    return true;
  }

  /** Forget after-pick without hiding (the window layer already hid everything). */
  function forgetAfterPick() {
    if (!afterPick) return false;
    if (afterPick.timer) clearTimer(afterPick.timer);
    afterPick = null;
    return true;
  }

  /** An explicit Toggle/Hold takes a target away from the automatic hide. */
  function claimTarget(target) {
    if (!afterPick) return;
    for (const id of targetPalettes(target)) afterPick.shown.delete(id);
    if (!afterPick.shown.size) {
      clearAfterPickTimer();
      afterPick = null;
    }
  }

  function scheduleAfterPick() {
    if (!afterPick) return;
    if (afterPick.timer) clearTimer(afterPick.timer);
    afterPick.timer = setTimer(() => endAfterPick(), AFTER_PICK_MS);
    if (afterPick.timer && typeof afterPick.timer.unref === 'function') afterPick.timer.unref();
  }

  /**
   * Alt+left released over the canvas. Reveal every target that opted in; record
   * only the windows that were hidden, so a window the user already had open is
   * never closed by the next stroke.
   */
  function afterColorPick() {
    if (!ctx.isShortcutActive()) return false;
    const shortcuts = shortcutsNow();
    const targets = [];
    if (shortcuts.app.mode === 'afterPick') targets.push('app');
    for (const [id, pair] of Object.entries(shortcuts.palettes)) {
      if (pair.mode === 'afterPick' && ctx.paletteExists(id)) targets.push(`palette:${id}`);
    }
    if (!targets.length) return false;

    // A hold on a target owns it: after-pick must not claim the same windows.
    const held = activeHold ? new Set(targetPalettes(activeHold.target)) : new Set();
    const ids = [];
    const seen = new Set();
    for (const target of targets) {
      for (const id of targetPalettes(target)) {
        if (seen.has(id) || held.has(id) || !ctx.paletteExists(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
    const hidden = ids.filter((id) => !isVisible(id));
    if (!hidden.length) {
      // A second pick while the reveal is still up merely extends its life.
      if (afterPick) scheduleAfterPick();
      return false;
    }

    const appTarget = targets.includes('app');
    if (appTarget) {
      // General after-pick shows all palette windows, but keeps Settings out of it.
      if (typeof ctx.showShortcutTarget === 'function') {
        ctx.showShortcutTarget('app', { clearSuppression: false, includeSettings: false });
      }
    } else {
      for (const id of hidden) {
        if (typeof ctx.showShortcutTarget === 'function') {
          ctx.showShortcutTarget(`palette:${id}`, { clearSuppression: false });
        }
      }
    }

    // Position only the windows that were actually hidden before this reveal.
    if (appTarget) {
      const primary = ctx.primaryPaletteId ? ctx.primaryPaletteId() : null;
      if (primary && hidden.includes(primary)) place(primary, shortcuts.app.position);
    } else {
      for (const id of hidden) {
        const pair = shortcuts.palettes[id];
        if (pair) place(id, pair.position);
      }
    }

    if (!afterPick) afterPick = { shown: new Set(), timer: null };
    for (const id of hidden) afterPick.shown.add(id);
    scheduleAfterPick();
    return true;
  }

  /** A normal (non-Alt) canvas down: the user continued drawing. */
  function drawingStarted() {
    return endAfterPick();
  }

  /**
   * A left-button down over CSP. After-pick hides only on a non-Alt canvas
   * stroke; Toggle's auto-dismiss hides on any CSP interaction (canvas or UI).
   */
  function interactionStarted(info = {}) {
    let changed = false;
    if (afterPick && !info.alt) changed = endAfterPick() || changed;
    if (dismiss) {
      const d = dismiss;
      dismiss = null;
      const parsed = ShortcutModel.parseTarget(d.target);
      if (parsed && parsed.kind === 'palette') {
        if (typeof ctx.hidePaletteWindow === 'function') {
          ctx.hidePaletteWindow(parsed.paletteId, { suppress: true });
        }
      } else if (typeof ctx.hidePopup === 'function') {
        ctx.hidePopup();
      }
      changed = true;
    }
    return changed;
  }

  function clearTransient() {
    clearAfterPickTimer();
    afterPick = null;
    dismiss = null;
  }

  // --- registration ---------------------------------------------------------

  function unregisterToggles() {
    for (const accel of toggles.values()) {
      try { globalShortcut.unregister(accel); } catch { /* already gone */ }
    }
    toggles = new Map();
  }

  function stopHolds() {
    for (const watcher of holds.values()) {
      try { watcher.stop(); } catch { /* already gone */ }
    }
    holds = new Map();
  }

  function stopBare() {
    for (const watcher of bareWatchers.values()) {
      try { watcher.stop(); } catch { /* already gone */ }
    }
    bareWatchers = new Map();
  }

  function setBareActive(active) {
    bareActive = Boolean(active);
    for (const watcher of bareWatchers.values()) {
      try { watcher.setActive(bareActive); } catch { /* gone */ }
    }
  }

  function setBareTyping(typing) {
    bareTyping = Boolean(typing);
    for (const watcher of bareWatchers.values()) {
      try { watcher.setTyping(bareTyping); } catch { /* gone */ }
    }
  }

  /** End a hold; `restore:false` means an explicit hide won the conflict. */
  function endHold(key, { restore = true } = {}) {
    if (!activeHold) return false;
    if (key && activeHold.key !== key) return false;
    const snapshot = activeHold.snapshot;
    activeHold = null;
    if (restore) {
      try { ctx.restoreShortcutVisibility(snapshot); } catch { /* windows may be gone */ }
    }
    return true;
  }

  function holdIncludes(id) {
    return Boolean(activeHold && targetPalettes(activeHold.target).includes(id));
  }

  function beginHold(target, key) {
    if (!ctx.isShortcutActive()) return false;
    const pair = ShortcutModel.targetShortcuts(shortcutsNow(), target);
    if (!pair || pair.mode !== 'hold') return false;
    endHold();
    // An explicit hold owns the target from now on: after-pick must not close it.
    claimTarget(target);
    const snapshot = ctx.captureShortcutVisibility(target);
    const ids = targetPalettes(target);
    const allVisible = ids.every((id) => snapshot.palette && snapshot.palette[id] !== false);
    activeHold = { key: key || targetKey(target, 'hold'), target, snapshot };
    if (allVisible) return true;
    if (typeof ctx.showShortcutTarget === 'function') {
      ctx.showShortcutTarget(target, { clearSuppression: false });
    }
    const parsed = ShortcutModel.parseTarget(target);
    if (parsed && parsed.kind === 'palette') place(parsed.paletteId, positionOf(target));
    else {
      const primary = ctx.primaryPaletteId ? ctx.primaryPaletteId() : null;
      if (primary && snapshot.palette && snapshot.palette[primary] === false) {
        place(primary, positionOf(target));
      }
    }
    return true;
  }

  function toggleTarget(target) {
    if (!ctx.isShortcutActive()) return false;
    const parsed = ShortcutModel.parseTarget(target);
    if (!parsed) return false;
    const pair = ShortcutModel.targetShortcuts(shortcutsNow(), target);
    if (!pair || pair.mode !== 'toggle') return false;
    claimTarget(target);

    if (parsed.kind === 'app') {
      // A General action supersedes an active hold: the key the user pressed wins.
      if (activeHold) endHold(null, { restore: false });
      const any = typeof ctx.anyBandVisible === 'function' && ctx.anyBandVisible();
      if (any) {
        dismiss = null;
        forgetAfterPick();
        ctx.hidePopup();
        return true;
      }
      forgetAfterPick();
      const primary = ctx.primaryPaletteId ? ctx.primaryPaletteId() : null;
      const primaryWasHidden = primary ? !isVisible(primary) : false;
      if (typeof ctx.showShortcutTarget === 'function') {
        ctx.showShortcutTarget('app', { clearSuppression: true, includeSettings: true });
      }
      if (primary && primaryWasHidden) place(primary, positionOf('app'));
      dismiss = pair.autoDismiss ? { target: 'app' } : null;
      return true;
    }

    const id = parsed.paletteId;
    const visible = isVisible(id);
    if (visible) {
      dismiss = null;
      if (holdIncludes(id)) activeHold.snapshot.palette[id] = false;
      if (typeof ctx.hidePaletteWindow === 'function') ctx.hidePaletteWindow(id, { suppress: true });
      return true;
    }
    if (holdIncludes(id)) activeHold.snapshot.palette[id] = true;
    if (typeof ctx.showShortcutTarget === 'function') {
      ctx.showShortcutTarget(`palette:${id}`, { clearSuppression: true });
    }
    place(id, positionOf(target));
    dismiss = pair.autoDismiss ? { target: `palette:${id}` } : null;
    return true;
  }

  function apply(settings = settingsNow()) {
    endHold();
    endAfterPick();
    dismiss = null;
    unregisterToggles();
    stopHolds();
    stopBare();
    failures = [];
    const shortcuts = ShortcutModel.normalise(settings.shortcuts);
    const list = ShortcutModel.bindings(shortcuts, null);
    for (const entry of list) {
      if (entry.action === 'command' || !entry.accel) continue;
      const parsed = ShortcutModel.parseTarget(entry.target);
      if (!parsed) continue;
      const accel = Match.parseAccelerator(entry.accel);
      if (accel.hook) {
        const key = entry.key;
        const watcher = new BareWatcher({ accel: entry.accel });
        watcher.on('down', () => {
          if (entry.action === 'toggle') toggleTarget(entry.target);
          else beginHold(entry.target, key);
        });
        watcher.on('up', () => { if (entry.action !== 'toggle') endHold(key); });
        watcher.on('failed', (reason) => {
          failures.push({ key, accel: entry.accel, error: reason || 'unavailable' });
          if (activeHold && activeHold.key === key) endHold(key);
        });
        watcher.on('gone', () => {
          if (activeHold && activeHold.key === key) endHold(key);
        });
        watcher.active = bareActive;
        watcher.typing = bareTyping;
        if (!watcher.start()) failures.push({ key, accel: entry.accel, error: 'unavailable' });
        else bareWatchers.set(key, watcher);
        continue;
      }
      if (entry.action === 'toggle') {
        let ok = false;
        try { ok = globalShortcut.register(entry.accel, () => toggleTarget(entry.target)); }
        catch { ok = false; }
        if (ok) toggles.set(entry.key, entry.accel);
        else failures.push({ key: entry.key, accel: entry.accel, error: 'taken' });
        continue;
      }
      const key = entry.key;
      const watcher = new HoldWatcher({ accel: entry.accel });
      watcher.on('down', () => beginHold(entry.target, key));
      watcher.on('up', () => endHold(key));
      watcher.on('taken', () => {
        failures.push({ key, accel: entry.accel, error: 'taken' });
        if (activeHold && activeHold.key === key) endHold(key);
      });
      watcher.on('gone', () => {
        if (activeHold && activeHold.key === key) endHold(key);
      });
      if (!watcher.start()) failures.push({ key, accel: entry.accel, error: 'unavailable' });
      else holds.set(key, watcher);
    }
    return { ok: failures.length === 0, failures };
  }

  async function set({ target, action, accel } = {}) {
    if (!ACTIONS.has(action)) return { ok: false, error: 'invalid-action' };
    const parsed = ShortcutModel.parseTarget(target);
    if (!parsed) return { ok: false, error: 'invalid-target' };
    if (parsed.kind === 'palette' && !ctx.paletteExists(parsed.paletteId)) {
      return { ok: false, error: 'unknown-palette' };
    }
    const value = String(accel || '').trim();
    if (value && !Match.validAccelerator(value, { allowBare: true })) {
      return { ok: false, error: 'invalid' };
    }
    const currentSettings = settingsNow();
    const previous = ShortcutModel.normalise(currentSettings.shortcuts);
    const pair = ShortcutModel.targetShortcuts(previous, target);
    if (!pair || pair.mode !== action) return { ok: false, error: 'mode-mismatch' };
    const next = patch(previous, target, action, value);
    if (value) {
      const conflict = ShortcutModel.findConflict(
        value, next, currentSettings.commandBindings, targetKey(target, action),
      );
      if (conflict) return { ok: false, error: 'conflict', conflictWith: conflict.key };
      // A bare key is not registered with the OS, so RegisterHotKey preflight
      // does not apply; the keyboard-hook watcher is the registration.
      if (action === 'hold' && !Match.parseAccelerator(value).hook) {
        const check = await checkHold(value);
        if (!check.ok) return { ok: false, error: check.error || 'unavailable' };
      }
    }
    const trialSettings = { ...currentSettings, shortcuts: next };
    const trial = apply(trialSettings);
    if (trial.failures.some((f) => f.key === targetKey(target, action))) {
      apply(currentSettings);
      return { ok: false, error: 'taken', failures: trial.failures };
    }
    ctx.settings.commit({ shortcuts: next, summonHotkey: next.app.toggle });
    return { ok: true, accel: value, failures: trial.failures };
  }

  /** After-pick checkbox, mode select, auto-dismiss checkbox, or position. */
  function setOption({ target, option, value } = {}) {
    const parsed = ShortcutModel.parseTarget(target);
    if (!parsed) return { ok: false, error: 'invalid-target' };
    if (parsed.kind === 'palette' && !ctx.paletteExists(parsed.paletteId)) {
      return { ok: false, error: 'unknown-palette' };
    }
    const next = ShortcutModel.normalise(settingsNow().shortcuts);
    let pair;
    if (parsed.kind === 'app') pair = next.app;
    else {
      pair = next.palettes[parsed.paletteId]
        || (next.palettes[parsed.paletteId] = {
          mode: 'toggle', toggle: '', hold: '', autoDismiss: false, position: 'keep',
        });
    }
    if (option === 'mode') {
      if (!ShortcutModel.MODES.includes(value)) return { ok: false, error: 'invalid-mode' };
      endHold();
      endAfterPick();
      dismiss = null;
      pair.mode = value;
    } else if (option === 'autoDismiss') {
      pair.autoDismiss = value === true;
      if (!pair.autoDismiss) dismiss = null;
    } else if (option === 'position') {
      if (!ShortcutModel.POSITIONS.includes(value)) return { ok: false, error: 'invalid-position' };
      pair.position = value;
    } else if (option === 'afterPick') {
      // Compatibility for the old after-pick switch.
      if (value === true) pair.mode = 'afterPick';
      else if (pair.mode === 'afterPick') pair.mode = 'toggle';
    } else return { ok: false, error: 'invalid-option' };
    if (option === 'mode' || option === 'afterPick') {
      if (afterPick) {
        for (const id of targetPalettes(target)) afterPick.shown.delete(id);
        if (!afterPick.shown.size) { clearAfterPickTimer(); afterPick = null; }
      }
    }
    ctx.settings.commit({ shortcuts: next });
    return { ok: true, target, option, value: pair[option] };
  }

  /** Compatibility alias for the old single Alt+click owner. */
  function setAltClick(target) {
    const value = String(target || '').trim();
    const next = ShortcutModel.normalise(settingsNow().shortcuts);
    next.app.mode = 'toggle';
    for (const pair of Object.values(next.palettes)) pair.mode = 'toggle';
    if (value === 'app') next.app.mode = 'afterPick';
    else {
      const parsed = ShortcutModel.parseTarget(value);
      if (parsed && parsed.kind === 'palette') {
        const pair = next.palettes[parsed.paletteId]
          || (next.palettes[parsed.paletteId] = {
            mode: 'toggle', toggle: '', hold: '', autoDismiss: false, position: 'keep',
          });
        pair.mode = 'afterPick';
      }
    }
    ctx.settings.commit({ shortcuts: next });
    return { ok: true };
  }

  function prune() {
    const settings = settingsNow();
    const { shortcuts, changed } = ShortcutModel.prune(settings.shortcuts, ctx.paletteIds());
    if (!changed) return false;
    ctx.settings.commit({ shortcuts });
    return true;
  }

  function stop() {
    endHold();
    clearTransient();
    unregisterToggles();
    stopHolds();
    stopBare();
  }

  return {
    apply,
    set,
    setOption,
    setAltClick,
    prune,
    stop,
    endHold,
    beginHold,
    endAfterPick,
    clearAfterPick: clearTransient,
    afterColorPick,
    drawingStarted,
    interactionStarted,
    setBareActive,
    setBareTyping,
    toggleTarget,
    active: () => Boolean(activeHold),
    afterPickActive: () => Boolean(afterPick),
    toggles: () => new Map(toggles),
  };
}

module.exports = { createShortcutActions, targetKey, AFTER_PICK_MS };

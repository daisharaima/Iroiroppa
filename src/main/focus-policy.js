'use strict';

// The auto-hide decision, pure.
//
// Visibility follows the **foreground process** while Auto-hide is on: Clip Studio Paint
// shows the palette, one of our own windows (Settings, a float) keeps it, and anything
// else hides it. There is deliberately no "the user showed it manually" pin: that flag
// was sticky, so one hotkey/tray show kept the palette on screen over every other app
// until Clip Studio Paint was seen again (the "it doesn't hide when CSP loses focus"
// report). A user who wants the palette pinned turns Auto-hide off — which is exactly
// what the setting says.
//
// Pure and injected so it is testable without Electron or a display.

/**
 * @param {{autoHide?: boolean, isCsp?: boolean, isOwn?: boolean, grace?: boolean}} state
 * @returns {'show'|'keep'|'hide'}
 */
function focusAction(state) {
  const s = state || {};
  // Off, or not managed by the watcher: leave the windows alone.
  if (s.autoHide === false) return 'keep';
  if (s.isCsp) return 'show';
  // The user is interacting with one of our own windows (Settings, a float).
  if (s.isOwn) return 'keep';
  // Text editing briefly makes the palette focusable; its blur must not hide it.
  if (s.grace) return 'keep';
  return 'hide';
}

module.exports = { focusAction };

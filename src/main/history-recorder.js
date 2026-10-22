'use strict';

// The one writer of the shared colour history (docs/STATE.md).
//
// Main sees every Companion colour once, and `CompanionService` emits `pick` for
// a real active-slot pick (src/main/service.js). The settle below is the fallback
// for picks that have no pointer gesture (keyboard, hex, paste): it collapses a
// burst into one tile after 450 ms of quiet.
//
// A pointer release in CSP is the precise end of a pick gesture: `pointer-history`
// does a fresh protocol read at the up and calls `commit(rgb, { replaceHostHead:
// true })`, which takes over the head the settle may already have added during the
// same gesture, so a drag still yields exactly one tile — with the last colour the
// protocol sent, not a poll-old one.
//
// It is deliberately Electron-free and timer-injectable, so `npm test` covers the
// ordering guarantees without a window. Every window's ColorStore only mirrors
// `setHistory`; a per-window settle timer is what used to let a hidden window add
// an older pick after a newer one (docs/INVARIANTS.md).

const { addToHistory, normalizeRgb } = require('../shared/history');

/**
 * @param {object} opts
 * @param {() => Array<{r:number,g:number,b:number}>} opts.list the shared list (mutated)
 * @param {number} opts.max the history cap (HISTORY_MAX)
 * @param {(list: Array) => void} opts.save persist the list
 * @param {() => void} opts.broadcast tell every window
 * @param {number} [opts.settleMs] fallback settle for a pick with no pointer up
 * @param {Function} [opts.setTimer]
 * @param {Function} [opts.clearTimer]
 */
function createHistoryRecorder({
  list, max, save, broadcast, settleMs = 450, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let pending = null;
  let timer = null;
  // The head was added by the fallback settle and has not been confirmed by a
  // pointer up yet; that up may replace it instead of adding a second tile.
  let unconfirmedHostHead = false;

  function publish() {
    const items = list();
    save(items);
    broadcast();
  }

  function add(rgb) {
    const items = list();
    if (!addToHistory(items, rgb, max)) return false;
    publish();
    return true;
  }

  function replaceHead(rgb) {
    const next = normalizeRgb(rgb);
    if (!next) return false;
    const items = list();
    if (!items.length) return add(next);
    const head = items[0];
    if (head && head.r === next.r && head.g === next.g && head.b === next.b) return false;
    items[0] = next;
    publish();
    return true;
  }

  function clear() {
    if (timer) clearTimer(timer);
    timer = null;
    pending = null;
  }

  function flush() {
    timer = null;
    const rgb = pending;
    pending = null;
    if (rgb && add(rgb)) unconfirmedHostHead = true;
  }

  return {
    /** Gate ON: remember a pick without adding it; the next contact consumes it. */
    note(rgb) {
      const next = normalizeRgb(rgb);
      if (!next) return;
      if (timer) clearTimer(timer);
      timer = null;
      pending = next;
    },
    /** Queue a host pick; the fallback settle adds it unless an up gets there first. */
    observe(rgb) {
      const next = normalizeRgb(rgb);
      if (!next) return;
      pending = next;
      if (timer) clearTimer(timer);
      timer = setTimer(flush, settleMs);
    },
    /**
     * A definitive pick: an explicit Iroiroppa commit, or the fresh read taken on
     * a pointer release in CSP. `replaceHostHead` lets the up take over the tile
     * the settle already added during this gesture.
     */
    commit(rgb, { replaceHostHead = false } = {}) {
      clear();
      const replace = replaceHostHead && unconfirmedHostHead;
      unconfirmedHostHead = false;
      return replace ? replaceHead(rgb) : add(rgb);
    },
    cancel: clear,
    pending() { return pending ? { ...pending } : null; },
    unconfirmed: () => unconfirmedHostHead,
  };
}

module.exports = { createHistoryRecorder };

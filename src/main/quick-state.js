'use strict';

/**
 * One shared Quick Access reader for the whole app.
 *
 * The Companion protocol has no "tell me your state" call: a read names the items it
 * wants, so *somebody* has to know the names. That is module knowledge (the brush
 * toggles are one example), which is why this poller is driven by subscribers rather
 * than by a fixed list:
 *
 *   - every subscriber declares the names it cares about; the poll asks about the union
 *     once, at one interval, however many subscribers there are;
 *   - the last set of names is kept after the last subscriber leaves, so the keyboard
 *     hook's "CSP cannot take a command" signal does not vanish the moment a module is
 *     unloaded (it is memory only, gone on restart);
 *   - nothing subscribed and nothing remembered means no poll at all — a poll nobody
 *     reads is pure cost.
 *
 * It never writes: applying a recipe must still take its own fresh read before clicking,
 * because a snapshot can be up to one interval old.
 */

const DEFAULT_INTERVAL_MS = 500;

/**
 * @param {object} options
 * @param {Function} options.read   `(names) => Promise<{ok, on, disabled}>`
 * @param {Function} [options.onChange] called with the snapshot when its content changes
 * @param {Function} [options.onBusy]   called with `true`/`false` for the keyboard mute
 * @param {number}   [options.intervalMs]
 */
function createQuickState({ read, onChange, onBusy, intervalMs = DEFAULT_INTERVAL_MS, now = Date.now } = {}) {
  /** owner id -> names */
  const watchers = new Map();
  /** The last non-empty union, kept after the last subscriber leaves. */
  let lastNames = [];
  let timer = null;
  let pending = null;
  let stopped = false;
  let snapshot = { ok: false, on: [], disabled: [], names: [], at: 0 };
  let busy = false;

  function union() {
    const seen = new Set();
    for (const names of watchers.values()) {
      for (const name of names || []) seen.add(name);
    }
    return [...seen];
  }

  function wanted() {
    const live = union();
    if (live.length) return live;
    return lastNames;
  }

  function sameList(a, b) {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    return b.every((x) => set.has(x));
  }

  function publish(next) {
    const changed = next.ok !== snapshot.ok
      || !sameList(next.on, snapshot.on)
      || !sameList(next.disabled, snapshot.disabled);
    snapshot = next;
    if (onChange && changed) {
      try { onChange(next); } catch { /* a listener must never stop the poll */ }
    }
    // "CSP would refuse a command right now": nothing is on and something is disabled.
    // That is the state a text layer (or any tool without these toggles) reports, so the
    // keyboard hook passes bare keys through instead of swallowing them.
    const nextBusy = Boolean(next.ok) && next.disabled.length > 0 && next.on.length === 0;
    if (nextBusy !== busy) {
      busy = nextBusy;
      if (onBusy) {
        try { onBusy(nextBusy); } catch { /* same */ }
      }
    }
  }

  /** One read, right now. Never overlaps another. */
  function runPoll() {
    if (pending) return pending;
    const names = wanted();
    if (!names.length) { stopTimer(); return undefined; }
    pending = (async () => {
      try {
        const out = await read(names);
        if (out && out.ok) {
          publish({
            ok: true,
            on: Array.isArray(out.on) ? out.on : [],
            disabled: Array.isArray(out.disabled) ? out.disabled : [],
            names,
            at: now(),
          });
        } else {
          // A failed read is not "CSP is free": keep the last content but mark it stale
          // so the mute can expire instead of trusting an old answer.
          publish({ ...snapshot, ok: false, names, at: now() });
        }
      } catch {
        publish({ ...snapshot, ok: false, names, at: now() });
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  /** The timer path: skip a tick rather than queueing behind one already running. */
  function tick() {
    if (stopped || pending) return;
    runPoll();
  }

  /** The explicit path: wait out a running read, then take a fresh one. */
  async function poll() {
    if (pending) { try { await pending; } catch { /* settled below */ } }
    if (stopped) return;
    return runPoll();
  }

  function startTimer() {
    if (timer || stopped) return;
    timer = setInterval(() => { tick(); }, intervalMs);
    if (timer.unref) timer.unref();
    // Poll once immediately so a fresh subscriber sees state without waiting a full tick.
    tick();
  }

  function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return {
    /** Declare the names one owner cares about; replaces that owner's list. */
    watch(owner, names) {
      const list = Array.isArray(names) ? names.filter((n) => typeof n === 'string' && n) : [];
      if (!list.length) return this.unwatch(owner);
      watchers.set(String(owner), list);
      lastNames = union();
      startTimer();
      return list.length;
    },
    unwatch(owner) {
      watchers.delete(String(owner));
      if (!union().length) {
        // Keep the last set: the keyboard mute should outlive the module that taught us.
        if (!lastNames.length) stopTimer();
      }
      return watchers.size;
    },
    /** Names the next tick will ask about (the union, else the remembered set). */
    names: wanted,
    /** The newest snapshot; `ok:false` means it is stale or the connection is down. */
    state: () => snapshot,
    /** True while CSP reports that it would refuse a command. */
    isBusy: () => busy,
    intervalMs,
    /** Test seam: run one poll now and await it, after any read already in flight. */
    poll,
    stop() {
      stopped = true;
      stopTimer();
      watchers.clear();
    },
    restart() {
      stopped = false;
      startTimer();
    },
    /** Forget the remembered names (used on disconnect). */
    forget() {
      lastNames = [];
      if (!union().length) stopTimer();
    },
  };
}

module.exports = { createQuickState, DEFAULT_INTERVAL_MS };

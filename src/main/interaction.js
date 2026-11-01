'use strict';

// The interaction hub (E1, colour only). docs/STATE.md, "local-first".
//
// One continuous gesture on a domain is an *interaction*: the originating window
// paints from its own preview immediately, main stays the only writer of
// canonical state, and a delayed acknowledgement can never overwrite a newer
// preview. This module is the bookkeeping only — it is Electron-free so the
// state machine is unit-tested headlessly (test/interaction.test.js).
//
// Rules (v9 §8):
//  - `begin` checks the base revision once; a stale begin is refused;
//  - one interaction per domain: a second `begin` supersedes the first;
//  - updates are applied in `seq` order, and a late or duplicate `seq` is dropped;
//  - an external change (a CSP echo that is not ours, a discrete command) ends
//    the interaction: the owner is told, and the epoch moves on;
//  - `end(commit)` closes it with the final value; `end(cancel)` leaves the
//    baseline to the caller.
//
// The epoch is internal: renderers never see it, they only see a reject.

/** How many recently sent values an interaction remembers. */
const RECENT_VALUES = 8;

/**
 * @param {{ now?: () => number }} [opts]
 */
function createInteractionHub({ now = Date.now } = {}) {
  /** domain -> { id, windowId, baseRev, seq, epoch, lastValue, startedAt } */
  const active = new Map();
  /** domain -> epoch counter, bumped whenever an interaction is displaced */
  const epochs = new Map();

  const epochOf = (domain) => epochs.get(domain) || 0;

  function supersede(domain, reason) {
    const cur = active.get(domain);
    if (!cur) return null;
    active.delete(domain);
    epochs.set(domain, epochOf(domain) + 1);
    return { interactionId: cur.id, windowId: cur.windowId, reason };
  }

  /**
   * Start an interaction. Returns `{ ok, rejected, reason }`; `rejected` is a
   * previously active interaction this one displaced (the caller tells its owner).
   */
  function begin({ id, domain, windowId, baseRev, currentRev }) {
    if (!id || !domain || !windowId) return { ok: false, reason: 'bad-args' };
    if (Number.isFinite(baseRev) && Number.isFinite(currentRev) && baseRev !== currentRev) {
      return { ok: false, reason: 'stale-base' };
    }
    const displaced = supersede(domain, 'superseded');
    active.set(domain, {
      id,
      windowId,
      baseRev: Number.isFinite(baseRev) ? baseRev : null,
      seq: 0,
      epoch: epochOf(domain),
      lastValue: null,
      // The last few values this interaction sent. A host echo can lag by more
      // than one update, so "is this ours?" must never be a comparison with the
      // newest value alone — that is how a lagging read-back would reject a live
      // drag. Same reasoning as the renderer's `_ownWrites` ring.
      recent: [],
      startedAt: now(),
    });
    return { ok: true, rejected: displaced };
  }

  /** Accept one update; returns `{ ok, drop?, reason? }`. */
  function update({ id, domain, seq, value }) {
    const cur = active.get(domain);
    if (!cur || cur.id !== id) return { ok: false, drop: true, reason: 'not-active' };
    if (Number.isFinite(seq) && seq <= cur.seq) return { ok: false, drop: true, reason: 'stale-seq' };
    cur.seq = Number.isFinite(seq) ? seq : cur.seq + 1;
    if (value !== undefined) noteValue(cur, value);
    return { ok: true, seq: cur.seq };
  }

  /** Remember a value this interaction sent (bounded, oldest out). */
  function noteValue(cur, value) {
    cur.lastValue = value;
    cur.recent.push(value);
    if (cur.recent.length > RECENT_VALUES) cur.recent.shift();
  }

  /**
   * True when `value` is one this interaction recently sent — an echo, however
   * late. `equals(a, b)` compares two domain values.
   */
  function isRecent(domain, value, equals) {
    const cur = active.get(domain);
    if (!cur || value === undefined) return false;
    return cur.recent.some((v) => equals(v, value));
  }

  /** Close an interaction; returns `{ ok, commit, value, rejected? }`. */
  function end({ id, domain, seq, value, reason = 'commit' }) {
    const cur = active.get(domain);
    if (!cur || cur.id !== id) return { ok: false, reason: 'not-active' };
    if (reason === 'cancel') {
      active.delete(domain);
      epochs.set(domain, epochOf(domain) + 1);
      return { ok: true, commit: false, value: cur.lastValue, baseRev: cur.baseRev };
    }
    if (Number.isFinite(seq) && seq < cur.seq) return { ok: false, reason: 'stale-seq' };
    if (value !== undefined) noteValue(cur, value);
    active.delete(domain);
    return { ok: true, commit: true, value: value === undefined ? cur.lastValue : value, seq: cur.seq };
  }

  /**
   * Something outside the interaction changed the domain (a host echo that is not
   * ours, a hotkey, another window's discrete command). Ends it and returns the
   * displaced interaction so the caller can reject it.
   */
  function invalidate(domain, reason = 'invalidated') {
    return supersede(domain, reason);
  }

  /** The active interaction for a domain, or null. */
  function get(domain) {
    const cur = active.get(domain);
    return cur ? { ...cur } : null;
  }

  /** True when this window owns the live interaction on the domain. */
  function owns(domain, windowId) {
    const cur = active.get(domain);
    return Boolean(cur) && cur.windowId === windowId;
  }

  /** Causation for a broadcast: `{ originWindowId, interactionId, acceptedThroughSeq }`. */
  function causation(domain) {
    const cur = active.get(domain);
    if (!cur) return null;
    return { originWindowId: cur.windowId, interactionId: cur.id, acceptedThroughSeq: cur.seq };
  }

  function domains() {
    return [...active.keys()];
  }

  return { begin, update, end, invalidate, get, owns, causation, isRecent, epochOf, domains };
}

module.exports = { createInteractionHub };

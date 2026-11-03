'use strict';

// One place that knows which implementation is serving each native capability.
//
// Four capabilities (band, foreground, pointer, keys) can each run on the native host
// or on the PowerShell fallback. Independent fallbacks are fine, but two
// implementations of one capability must never run together, and a capability must not
// silently die — a failed keyboard hook looks exactly like "the user is not typing".
//
// States per capability: 'host' (native), 'ps' (PowerShell fallback), 'down' (neither).

const { EventEmitter } = require('node:events');

const CAPABILITIES = ['band', 'foreground', 'pointer', 'keys'];

class HelperHealth extends EventEmitter {
  constructor(capabilities = CAPABILITIES) {
    super();
    this.capabilities = capabilities.slice();
    this.caps = {};
    for (const name of this.capabilities) this.caps[name] = 'unknown';
  }

  /**
   * Record which implementation serves `capability`. Emits `changed` only on a real
   * transition, so a 100 ms band tick does not spam a log.
   */
  set(capability, state) {
    if (!Object.prototype.hasOwnProperty.call(this.caps, capability)) return false;
    if (this.caps[capability] === state) return false;
    const previous = this.caps[capability];
    this.caps[capability] = state;
    this.emit('changed', { capability, from: previous, to: state, summary: this.summary() });
    return true;
  }

  get(capability) {
    return this.caps[capability];
  }

  /**
   * Overall state: healthy when everything that reports is on the host, down when nothing
   * serves it, degraded when something fell back or stopped. A capability that has not
   * reported yet is *pending*, not degraded — a profile with no bare-key binding never
   * reports `keys` at all, and a permanent warning dot would be a lie.
   */
  summary() {
    const degraded = this.capabilities.filter((name) => this.caps[name] === 'ps');
    const down = this.capabilities.filter((name) => this.caps[name] === 'down');
    const pending = this.capabilities.filter((name) => this.caps[name] === 'unknown');
    let state = 'healthy';
    if (down.length === this.capabilities.length) state = 'down';
    else if (degraded.length || down.length) state = 'degraded';
    return {
      state,
      caps: { ...this.caps },
      onFallback: degraded,
      unavailable: down,
      pending,
    };
  }

  /** A one-line description for a log or a status surface. */
  describe() {
    const { state, onFallback, unavailable, pending } = this.summary();
    const parts = [];
    if (onFallback.length) parts.push(`on PowerShell: ${onFallback.join(', ')}`);
    if (unavailable.length) parts.push(`unavailable: ${unavailable.join(', ')}`);
    if (state === 'healthy') {
      return pending.length ? `native helpers healthy (${pending.join(', ')} not yet reported)` : 'native helpers healthy';
    }
    if (pending.length) parts.push(`not yet reported: ${pending.join(', ')}`);
    return `helpers ${state} (${parts.join('; ')})`;
  }
}

module.exports = { HelperHealth, CAPABILITIES };

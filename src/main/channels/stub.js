'use strict';

// Capability adapter: the stub channel. Always available, it stands in for a real
// channel so a two-channel module is testable (and `--shot`-renderable) with only
// one, and so a module that prefers one source can be exercised deterministically.

function stubChannel() {
  return { id: 'stub', label: 'Stub channel', available: true, reason: '' };
}

module.exports = { stubChannel };

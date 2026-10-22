'use strict';

// Capability adapter: native senders. Available on Windows, where the PowerShell
// helper can drive `SendKeys`; a key/message actuator is the fallback for a CSP
// command the protocol cannot invoke.

function senderChannel({ available = process.platform === 'win32', reason = '' } = {}) {
  return {
    id: 'sender',
    label: 'Native sender',
    available,
    reason: available ? reason : 'Windows only',
  };
}

module.exports = { senderChannel };

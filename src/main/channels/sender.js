'use strict';

function senderChannel({ available = process.platform === 'win32', reason = '' } = {}) {
  return {
    id: 'sender',
    label: 'Native sender',
    available,
    reason: available ? reason : 'Windows only',
  };
}

module.exports = { senderChannel };

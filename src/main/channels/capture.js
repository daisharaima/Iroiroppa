'use strict';

function captureChannel({ available = true, reason = '' } = {}) {
  return { id: 'capture', label: 'Window capture', available, reason };
}

module.exports = { captureChannel };

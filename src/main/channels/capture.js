'use strict';

// Capability adapter: the window-capture channel. Available when a capturer is
// present (Electron's desktopCapturer); the source *list* may still be empty, so
// availability is about the channel, not the windows.

function captureChannel({ available = true, reason = '' } = {}) {
  return { id: 'capture', label: 'Window capture', available, reason };
}

module.exports = { captureChannel };

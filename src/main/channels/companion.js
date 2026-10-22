'use strict';

// Capability adapter: the Companion protocol. Available while a Companion
// connection is up; the service's own status is the source of truth, so main
// calls `sync(status)` on every 'status' event. The adapter holds no state of its
// own — `sync` folds a status into `{ available, reason }`.

const REASONS = {
  idle: 'not connected — open File > Connect to smartphone in Clip Studio Paint',
  scanning: 'scanning for the QR code',
  connecting: 'connecting',
  reconnecting: 'reconnecting',
  failed: 'connection failed',
};

/** @param {object} service the CompanionService (its `status()` is the live state) */
function companionChannel(service) {
  return {
    id: 'companion',
    label: 'Companion protocol',
    /** Fold a service status (or the current one) into `{ available, reason }`. */
    sync(status) {
      const s = status || (service && typeof service.status === 'function' ? service.status() : {}) || {};
      const available = s.state === 'connected';
      return {
        available,
        reason: available ? '' : (REASONS[s.state] || s.detail || 'not connected'),
      };
    },
  };
}

module.exports = { companionChannel };

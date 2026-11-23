'use strict';

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

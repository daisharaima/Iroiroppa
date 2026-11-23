'use strict';

const cap = require('../shared/capabilities');
const { companionChannel } = require('./channels/companion');
const { captureChannel } = require('./channels/capture');
const { senderChannel } = require('./channels/sender');
const { stubChannel } = require('./channels/stub');

/** `--name=a,b` → ['a','b'] (empty when the flag is absent). */
function flagList(name, argv = process.argv) {
  const prefix = `--${name}=`;
  const arg = (argv || []).find((a) => typeof a === 'string' && a.startsWith(prefix));
  return arg ? arg.slice(prefix.length).split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * @param {object} opts
 * @param {object} [opts.service] the CompanionService
 * @param {(channel: string, payload: object) => void} [opts.broadcast]
 * @param {string[]} [opts.argv]
 */
function createMainCapabilities({ service, broadcast, argv = process.argv } = {}) {
  const companion = companionChannel(service);
  const capabilities = cap.createCapabilities({
    channels: {
      companion: companion.sync(),
      capture: captureChannel(),
      sender: senderChannel(),
      stub: stubChannel(),
    },
  });

  for (const id of flagList('cap-off', argv)) {
    capabilities.set(id, { available: false, reason: 'disabled (--cap-off)' });
  }
  for (const id of flagList('capabilities', argv)) {
    capabilities.set(id, { available: true, reason: '' });
  }

  if (typeof broadcast === 'function') {
    capabilities.on((state) => broadcast('capabilities:changed', state));
  }
  if (service && typeof service.on === 'function') {
    service.on('status', (s) => capabilities.set('companion', companion.sync(s)));
  }
  return capabilities;
}

module.exports = { createMainCapabilities, flagList };

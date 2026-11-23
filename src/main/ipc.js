'use strict';

const { BrowserWindow } = require('electron');
const { isTrustedSender } = require('./ipc-sender');
const { createHelpers } = require('./ipc/helpers');

/**
 * @param {object} ctx main.js's app context
 */
function wireIpc(ctx) {

  const trusted = (event) => isTrustedSender(event, (wc) => BrowserWindow.fromWebContents(wc));
  const h = createHelpers(ctx, trusted);
  require('./ipc/app').register(ctx, trusted);
  require('./ipc/modules').register(ctx, trusted);
  require('./ipc/layout').register(ctx, h);
  require('./ipc/window').register(ctx, h);
  require('./ipc/commands').register(ctx, h);
  require('./ipc/settings').register(ctx, h);

  require('./ipc/interaction').register(ctx, trusted);
}

module.exports = { wireIpc };

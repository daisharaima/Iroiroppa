'use strict';

// The renderer -> main IPC surface (docs/STATE.md).
//
// Split into domain group files; each registers its own channels. `main.js`
// threads its app context through `wireIpc(ctx)`.

const { BrowserWindow } = require('electron');
const { isTrustedSender } = require('./ipc-sender');
const { createHelpers } = require('./ipc/helpers');

/**
 * @param {object} ctx main.js's app context
 */
function wireIpc(ctx) {
  // Every privileged channel comes from a live window this app owns; the sender is
  // resolved from the event, never trusted from the payload (docs/STATE.md).
  const trusted = (event) => isTrustedSender(event, (wc) => BrowserWindow.fromWebContents(wc));
  const h = createHelpers(ctx, trusted);
  require('./ipc/app').register(ctx, trusted);
  require('./ipc/modules').register(ctx, trusted);
  require('./ipc/layout').register(ctx, h);
  require('./ipc/window').register(ctx, h);
  require('./ipc/commands').register(ctx, h);
  require('./ipc/settings').register(ctx, h);
}

module.exports = { wireIpc };

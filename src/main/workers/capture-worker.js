'use strict';

// The compute worker (docs/STATE.md, §6 Phase 4). It runs inside a utilityProcess,
// off the main thread, and only does CPU work the main process hands it — here a
// QR decode of a raw RGBA frame. It owns no state and never reaches for a window.
//
// Electron's `desktopCapturer` stays in main (it is main-only); the frame crosses
// as plain `{ rgba, width, height }`. Requiring capture.js is safe here: it pulls
// jsQR eagerly and electron lazily, and the worker only calls the pure decoder.

const Compute = require('../../shared/compute-protocol');
const { decodeQrFrame } = require('../capture');

const handlers = {
  'qr-decode': (frame) => decodeQrFrame(frame),
};

if (process.parentPort) {
  process.parentPort.on('message', (event) => {
    const req = event.data;
    if (!Compute.isRequest(req)) return;
    const handler = handlers[req.type];
    try {
      const value = handler ? handler(req.payload) : undefined;
      process.parentPort.postMessage(Compute.createReply(req.id, true, value, null));
    } catch (err) {
      process.parentPort.postMessage(Compute.createReply(req.id, false, null, String((err && err.message) || err)));
    }
  });
}

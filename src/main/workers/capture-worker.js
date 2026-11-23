'use strict';

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

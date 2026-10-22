'use strict';

// A minimal fake CSP Companion Mode host for developing/testing the UI without
// Clip Studio Paint. It answers Authenticate, TellHeartbeat and
// SyncColorCircleUIState, and logs SetCurrentColor.
//
//   node scripts/fake-host.js [main|sub|transparent] [port] [cycle] [--main #rrggbb] [--sub #rrggbb]
//
// Point the app at it by writing a session.json whose ips/port match (the app
// reconnects automatically), e.g. 127.0.0.1:<port>.

const net = require('node:net');
const { parseFrame, splitFrames, encodeFrame, TYPE } = require('../src/main/companion/packets');
const Color = require('../src/shared/color');

const MAX = 4294967295;
const mode = process.argv[2] || 'main';
const port = Number(process.argv[3] || 45999);

/** `--main #rrggbb` / `--sub #rrggbb` report explicit slot colours. */
const hexArg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const hsvOf = (hex) => {
  const rgb = hex && Color.hexToRgb(hex);
  if (!rgb) return null;
  const hsv = Color.rgbToHsv(rgb.r / 255, rgb.g / 255, rgb.b / 255);
  return {
    h: Math.round((hsv.h / 360) * MAX),
    s: Math.round(hsv.s * MAX),
    v: Math.round(hsv.v * MAX),
  };
};
const mainHsv = hsvOf(hexArg('--main'));
const subHsv = hsvOf(hexArg('--sub'));

const swap = mode === 'sub';
const payload = {
  ColorSelectionModel: 'HSV',
  CurrentColorIndex: swap ? 1 : 0,
  HSVColorMainH: mainHsv ? mainHsv.h : 0,
  HSVColorMainS: mainHsv ? mainHsv.s : MAX,
  HSVColorMainV: mainHsv ? mainHsv.v : MAX, // default: red
  HSVColorSubH: subHsv ? subHsv.h : Math.round((240 / 360) * MAX),
  HSVColorSubS: subHsv ? subHsv.s : MAX,
  HSVColorSubV: subHsv ? subHsv.v : MAX, // default: blue
  IsCurrentColorTransparent: mode === 'transparent',
  CurrentToolAlphaPercent: 100,
  CanExecuteSetterCommand: true,
  IsManipulating: false,
};

// `cycle` mutates the state over time to emulate a user eyedropping in CSP.
if (process.argv.includes('cycle')) {
  let i = 0;
  setInterval(() => {
    i++;
    const h = Math.round(((i * 13) % 360) / 360 * MAX);
    if (i % 4 === 0) payload.CurrentColorIndex = payload.CurrentColorIndex === 0 ? 1 : 0;
    if (payload.CurrentColorIndex === 0) payload.HSVColorMainH = h;
    else payload.HSVColorSubH = h;
  }, 300);
}

const server = net.createServer((sock) => {
  let buffer = Buffer.alloc(0);
  sock.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { frames, rest } = splitFrames(buffer);
    buffer = Buffer.from(rest);
    for (const frame of frames) {
      const pkt = parseFrame(frame);
      if (!pkt || pkt.type !== TYPE.CLIENT) continue;
      let detail = null;
      if (pkt.command === 'Authenticate') {
        detail = JSON.stringify({
          AuthErrorReason: 'Unknown',
          RemoteCommandSpecVersionOfServer: 'G#1:2022.12',
          IsQuickAccessAvailable: true,
        });
      } else if (pkt.command === 'SyncColorCircleUIState') {
        detail = JSON.stringify(payload);
      } else if (pkt.command === 'SetCurrentColor') {
        console.log('SetCurrentColor', pkt.rawDetail.toString('utf8'));
      }
      try {
        sock.write(encodeFrame(TYPE.SUCCESS, pkt.command, pkt.serial, detail));
      } catch { /* client went away */ }
    }
  });
  sock.on('error', () => {});
});

server.listen(port, '127.0.0.1', () => {
  console.log(`fake host on 127.0.0.1:${port} mode=${mode}`);
});

'use strict';

// A minimal fake CSP Companion Mode host for developing/testing the UI without
// Clip Studio Paint. It answers Authenticate, TellHeartbeat, SyncColorCircleUIState
// and the two Quick Access commands (so a module that reads brush sub-tool flags
// works against it), and logs SetCurrentColor.
//
//   node scripts/fake-host.js [main|sub|transparent] [port] [cycle] [--main #rrggbb] [--sub #rrggbb]
//                                [--flags toolpressuretosize,toolbrushusewatercolor]
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

// --- Quick Access state (docs/PROTOCOL.md) -----------------------------------
// The brush sub-tool flags a module reads with SyncQuickAccessUIState and clicks
// with DoQuickAccess. Checkboxes flip; the toolcomposite* names behave like a
// strict radio group (clicking the active one is a no-op), which is what a real
// CSP build does unless the C1 spike says otherwise. An unknown name changes
// nothing but still answers success — the behaviour callers must read back from.
const COMPOSITE_PREFIX = 'toolcomposite';
const flags = new Map();
for (const name of (process.argv.find((a) => a.startsWith('--flags=')) || '').slice(8).split(',')) {
  if (name.trim()) flags.set(name.trim(), true);
}

/** The item IDs a request asked about, from its raw JSON detail. */
function requestedNames(rawDetail) {
  try {
    const detail = JSON.parse(rawDetail.toString('utf8'));
    const list = Array.isArray(detail.UpdateTargetItemIDs) ? detail.UpdateTargetItemIDs : [];
    return list.map((item) => item && item.ItemIDCommandName).filter((n) => typeof n === 'string');
  } catch { return []; }
}

/** The checked item IDs for a set of names — an item that is off is absent. */
function checkedItems(names) {
  return names.filter((name) => flags.get(name) === true).map((name) => ({
    ItemIDType: 'Command', ItemIDCommandType: 'advancedcommand',
    ItemIDCommandName: name, ItemIDToolUuid: '',
  }));
}

/** Click one Quick Access command by name: flip a checkbox, select a composite. */
function clickCommand(name) {
  if (!name) return false;
  if (name.startsWith(COMPOSITE_PREFIX)) {
    const wasOn = flags.get(name) === true;
    for (const key of [...flags.keys()]) {
      if (key.startsWith(COMPOSITE_PREFIX)) flags.set(key, false);
    }
    if (!wasOn) flags.set(name, true);
    return true;
  }
  if (name.startsWith('tool')) {
    flags.set(name, flags.get(name) !== true);
    return true;
  }
  return false; // unknown: the host still answers success
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
      } else if (pkt.command === 'SyncQuickAccessUIState') {
        const names = requestedNames(pkt.rawDetail);
        detail = JSON.stringify({ CheckedItemIDs: checkedItems(names), DisabledItemIDs: [] });
      } else if (pkt.command === 'DoQuickAccess') {
        try {
          const spec = JSON.parse(pkt.rawDetail.toString('utf8'));
          if (!clickCommand(spec && spec.ItemCommandName)) {
            console.log('DoQuickAccess (no-op)', pkt.rawDetail.toString('utf8'));
          }
        } catch { /* malformed: still answer success, like the host */ }
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

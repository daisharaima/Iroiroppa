#!/usr/bin/env node
'use strict';

// Standalone probe for the CSP Companion Mode connection.
//
//   node scripts/probe.js                    scan the screen for the QR and connect
//   node scripts/probe.js "<url-or-hex>"     use a QR payload you already have
//   node scripts/probe.js --set "#4DF7F8"    set the current CSP color
//   node scripts/probe.js --quick [index]    probe the Quick Access commands
//   node scripts/probe.js --watch            poll CSP's color until Ctrl+C
//
// Open File > Connect to smartphone in Clip Studio Paint before scanning.

const { CompanionClient } = require('../src/main/companion/client');
const { decodeConfig, isShareUrl } = require('../src/main/companion/qr');
const { findQr } = require('../src/main/capture');
const Color = require('../src/shared/color');

const argv = process.argv.slice(2);

// Parse `--flag value` and `--bool` separately from positional arguments.
const opts = Object.create(null);
const positional = [];
const VALUE_FLAGS = new Set(['--set', '--timeout', '--quick']);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    if (VALUE_FLAGS.has(a)) opts[a] = argv[++i];
    else opts[a] = true;
  } else {
    positional.push(a);
  }
}
const flagValue = (name) => opts[name];
const has = (name) => Boolean(opts[name]);

function fmtHex(rgb) {
  return Color.rgbToHex(rgb.r, rgb.g, rgb.b);
}

function describe(rgb) {
  const lch = Color.rgbToOklch(rgb.r / 255, rgb.g / 255, rgb.b / 255);
  const hsv = Color.rgbToHsv(rgb.r / 255, rgb.g / 255, rgb.b / 255);
  return [
    fmtHex(rgb),
    `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    `oklch(${lch.L.toFixed(3)} ${lch.C.toFixed(3)} ${lch.H.toFixed(1)})`,
    `hsv(${hsv.h.toFixed(1)} ${(hsv.s * 100).toFixed(0)}% ${(hsv.v * 100).toFixed(0)}%)`,
  ].join('  ');
}

async function resolvePayload() {
  if (positional[0]) {
    console.log('Using QR payload from the command line.');
    return positional[0];
  }
  console.log('Scanning the screen for a CSP Companion Mode QR code...');
  console.log('(In Clip Studio Paint: File > Connect to smartphone, and leave the QR visible.)');
  const found = await findQr({
    accept: isShareUrl,
    timeoutMs: Number(flagValue('--timeout') || 90000),
    onAttempt: (n) => process.stdout.write(`\r  scan attempt ${n}...`),
  });
  process.stdout.write('\n');
  if (!found) {
    console.error('No companion QR code found on screen.');
    process.exit(1);
  }
  return found;
}

async function main() {
  const payload = await resolvePayload();
  const cfg = decodeConfig(payload);
  console.log(`Decoded host: ${cfg.ips.join(', ')}:${cfg.port}  generation=${cfg.generation}`);

  const client = new CompanionClient(cfg);
  if (process.env.CSP_DEBUG) {
    client.on('command', (p) => console.log(`  <- ${p.command} ${p.rawDetail?.toString('utf8') ?? ''}`));
  }
  client.on('disconnect', () => console.log('  connection closed'));
  client.on('reconnecting', (d) => console.log(`  reconnecting in ${d}ms...`));

  await client.connect();
  const auth = await client.authenticate();
  console.log(`Connected and authenticated. Server spec=${auth.serverSpecVersion} quickAccess=${auth.quickAccessAvailable}`);

  const read = () => client.readColor().then((c) => {
    if (!c) return console.log('  (host returned no color)');
    console.log(`  CSP color: ${describe(c.rgb)}${c.transparent ? '  [transparent]' : ''}`);
    return c;
  });

  console.log('Reading current color:');
  await read();

  if (has('--quick')) {
    // The protocol's Quick Access surface — the go/no-go for invoking a CSP
    // command over the wire instead of a native sender.
    console.log('\nQuick Access experiment:');
    try {
      const data = await client.request('GetQuickAccessData', {}, { timeoutMs: 8000 });
      console.log('  GetQuickAccessData ->', JSON.stringify(data).slice(0, 600));
    } catch (err) {
      console.log('  GetQuickAccessData failed:', err.message);
    }
    const idx = Number(flagValue('--quick')) || 0;
    try {
      const res = await client.request('DoQuickAccess', { index: idx }, { timeoutMs: 8000 });
      console.log(`  DoQuickAccess(${idx}) ->`, JSON.stringify(res).slice(0, 600));
    } catch (err) {
      console.log('  DoQuickAccess failed:', err.message);
    }
  }

  const setHex = flagValue('--set');
  if (setHex) {
    const rgb = Color.hexToRgb(setHex);
    if (!rgb) throw new Error(`invalid --set color "${setHex}"`);
    await client.setColorRgb(rgb.r, rgb.g, rgb.b);
    console.log(`\nSet CSP color to ${flagValue('--set').toUpperCase()}.`);
    await new Promise((r) => setTimeout(r, 400));
    await read();
  }

  if (has('--watch')) {
    console.log('\nWatching (Ctrl+C to stop)...');
    setInterval(read, 500);
    return; // keep the process alive
  }

  client.close();
  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nProbe failed:', err.message);
  process.exit(1);
});

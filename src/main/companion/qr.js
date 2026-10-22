'use strict';

// Decoding of the Companion Mode QR payload.
//
// The QR the desktop shows under "Connect to smartphone" encodes a URL such as
//   https://companion.clip-studio.com/rc/en-us?s=<hex>
// The `s` value is the connection config XOR-obfuscated with REMOTE_KEY:
//   <ip[,ip...]>\t<port>\t<password>\t<generation>

const { obfuscateRemoteParam } = require('./crypto');

const SHARE_HOST = 'companion.clip-studio.com';

class QrDecodeError extends Error {}

/**
 * Decode a companion share URL (or a bare `s=` hex string) into connection
 * details.
 * @returns {{ips:string[], port:number, password:string, generation:string}}
 */
function decodeConfig(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new QrDecodeError('empty QR payload');

  let sParam;
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new QrDecodeError('could not parse the QR URL');
    }
    if (url.host !== SHARE_HOST) {
      throw new QrDecodeError(`unexpected QR host "${url.host}" (expected ${SHARE_HOST})`);
    }
    sParam = url.searchParams.get('s') || '';
    if (!sParam) throw new QrDecodeError('QR URL has no "s" parameter');
  } else if (raw.includes('?s=')) {
    // Some scanners hand back only the query fragment.
    sParam = raw.slice(raw.indexOf('?s=') + 3);
  } else {
    sParam = raw; // assume the user pasted the raw hex
  }

  if (!/^[0-9a-fA-F]+$/.test(sParam) || sParam.length % 2 !== 0) {
    throw new QrDecodeError('the "s" value is not valid hex');
  }

  const plain = obfuscateRemoteParam(Buffer.from(sParam, 'hex')).toString('utf8');
  const parts = plain.split('\t');
  if (parts.length !== 4) {
    throw new QrDecodeError(`decoded config has ${parts.length} fields, expected 4`);
  }

  const ips = parts[0].split(',').map((s) => s.trim()).filter(Boolean);
  const port = Number.parseInt(parts[1], 10);
  if (ips.length === 0) throw new QrDecodeError('decoded config has no IP addresses');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new QrDecodeError(`decoded config has an invalid port "${parts[1]}"`);
  }

  return { ips, port, password: parts[2], generation: parts[3] };
}

/** Predicate for screen scanning: is this decoded text a valid share URL? */
function isShareUrl(text) {
  try {
    decodeConfig(text);
    return true;
  } catch {
    return false;
  }
}

/** Encode connection details back into a share URL (used by tests/tools). */
function encodeConfig({ ips, port, password, generation }) {
  const plain = [Array.isArray(ips) ? ips.join(',') : ips, String(port), password, generation].join('\t');
  const enc = obfuscateRemoteParam(Buffer.from(plain, 'utf8'));
  return `https://${SHARE_HOST}/rc/en-us?s=${enc.toString('hex')}`;
}

module.exports = { decodeConfig, isShareUrl, encodeConfig, QrDecodeError, SHARE_HOST };

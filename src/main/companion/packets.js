'use strict';

// Wire framing for the CSP Companion Mode TCP protocol.
//
// Frame layout (0x1e = record separator, 0x00 = terminator):
//
//   <type> $tcp_remote_command_protocol_version=1.0 \x1e$
//   command=<NAME> \x1e$ serial=<N> \x1e$ detail=<JSON> \x1e \x00
//
// Packet types: 0x01 = client command, 0x06 = success/ACK, 0x15 = error/NAK.
// The 0x1e separators are stored as the two-byte sequence [0x1e, '$'].

const { Buffer } = require('node:buffer');

const TYPE = Object.freeze({
  CLIENT: 0x01,
  SUCCESS: 0x06,
  ERROR: 0x15,
});

const PROTOCOL_VERSION = 'tcp_remote_command_protocol_version=1.0';
const SEP = Buffer.from([0x1e, 0x24]); // 0x1e '$'
const TERM = 0x00;
const DETAIL_SEP = 0x0b;

/**
 * Encode one frame.
 * @param {number} type       packet type (TYPE.*)
 * @param {string} command    command name
 * @param {number} serial     per-direction serial number
 * @param {Buffer|string|null} detail JSON detail body (already encoded) or null
 * @returns {Buffer}
 */
function encodeFrame(type, command, serial, detail) {
  const body = detail == null
    ? Buffer.alloc(0)
    : Buffer.isBuffer(detail) ? detail : Buffer.from(String(detail), 'utf8');

  const mid = Buffer.from(`command=${command}` + '\x1e$' + `serial=${serial}` + '\x1e$' + 'detail=', 'latin1');

  return Buffer.concat([
    Buffer.from([type]),
    Buffer.from(`$${PROTOCOL_VERSION}`, 'latin1'),
    SEP,
    mid,
    body,
    Buffer.from([0x1e, TERM]),
  ]);
}

/**
 * Split a receive buffer into complete frames ("...\x00"). Returns the complete
 * frames plus any trailing partial frame so the caller can re-buffer it. CSP
 * may coalesce several frames into one TCP read, so callers must accumulate.
 */
function splitFrames(buffer) {
  const frames = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === TERM) {
      frames.push(buffer.subarray(start, i + 1));
      start = i + 1;
    }
  }
  return { frames, rest: buffer.subarray(start) };
}

/**
 * Parse one complete frame (including its 0x00 terminator).
 * Returns null for malformed input rather than throwing, so a single bad frame
 * never tears down the connection.
 */
function parseFrame(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf[buf.length - 1] !== TERM) return null;

  const type = buf[0];
  if (buf[1] !== 0x24 /* '$' */) return null;

  // Strip leading "<type>$" and trailing "\x1e\x00".
  const body = buf.subarray(2, buf.length - 2);

  const parts = splitOn(body, SEP);
  if (parts.length !== 4) return null;
  if (parts[0].toString('latin1') !== PROTOCOL_VERSION) return null;

  const cmdPart = parts[1].toString('latin1');
  const serPart = parts[2].toString('latin1');
  const detPart = parts[3].toString('latin1');
  if (!cmdPart.startsWith('command=')) return null;
  if (!serPart.startsWith('serial=')) return null;
  if (!detPart.startsWith('detail=')) return null;

  const serial = Number.parseInt(serPart.slice(7), 10);
  if (!Number.isFinite(serial)) return null;

  // detail may be "<json>" or "<json>\x0b<binary tail>".
  const detailBytes = parts[3].subarray(7);
  const sepIdx = detailBytes.indexOf(DETAIL_SEP);
  const jsonBytes = sepIdx === -1 ? detailBytes : detailBytes.subarray(0, sepIdx);
  const data = sepIdx === -1 ? null : detailBytes.subarray(sepIdx + 1);

  let detail = null;
  if (jsonBytes.length > 0) {
    try {
      detail = JSON.parse(jsonBytes.toString('utf8'));
    } catch {
      detail = undefined; // present but unparseable — kept distinct from "absent"
    }
  }

  return {
    type,
    command: cmdPart.slice(8),
    serial,
    detail,
    rawDetail: jsonBytes,
    data,
  };
}

/** Split a buffer on a multi-byte delimiter. */
function splitOn(buf, delim) {
  const out = [];
  let start = 0;
  for (let i = 0; i + delim.length <= buf.length; i++) {
    let hit = true;
    for (let j = 0; j < delim.length; j++) {
      if (buf[i + j] !== delim[j]) { hit = false; break; }
    }
    if (hit) {
      out.push(buf.subarray(start, i));
      i += delim.length - 1;
      start = i + 1;
    }
  }
  out.push(buf.subarray(start));
  return out;
}

module.exports = {
  TYPE,
  PROTOCOL_VERSION,
  TERM,
  DETAIL_SEP,
  encodeFrame,
  splitFrames,
  parseFrame,
};

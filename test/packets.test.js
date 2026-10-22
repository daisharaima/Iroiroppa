'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { encodeFrame, splitFrames, parseFrame, TYPE } = require('../src/main/companion/packets');

test('encodeFrame has the documented byte shape', () => {
  const frame = encodeFrame(TYPE.CLIENT, 'TellHeartbeat', 0, null);
  assert.equal(frame[0], 0x01);
  assert.equal(frame[1], 0x24); // '$'
  assert.equal(frame[frame.length - 1], 0x00);
  assert.equal(frame[frame.length - 2], 0x1e);
  const text = frame.toString('latin1');
  assert.ok(text.slice(1).startsWith('$tcp_remote_command_protocol_version=1.0\u001e$command=TellHeartbeat'));
  assert.ok(text.includes('\u001e$serial=0\u001e$detail='));
});

test('frame round-trips a JSON detail', () => {
  const detail = { ShiftPushed: false, CtrlPushed: true, AltPushed: false };
  const frame = encodeFrame(TYPE.SUCCESS, 'GetModifyKeyString', 7, JSON.stringify(detail));
  const pkt = parseFrame(frame);
  assert.equal(pkt.type, TYPE.SUCCESS);
  assert.equal(pkt.command, 'GetModifyKeyString');
  assert.equal(pkt.serial, 7);
  assert.deepEqual(pkt.detail, detail);
  assert.equal(pkt.data, null);
});

test('frame round-trips an empty detail', () => {
  const frame = encodeFrame(TYPE.SUCCESS, 'GetQuickAccessData', 0, null);
  const pkt = parseFrame(frame);
  assert.equal(pkt.rawDetail.length, 0);
  assert.equal(pkt.detail, null);
});

test('frame keeps a 0x0B binary tail out of the JSON', () => {
  const json = '{"Operation":"ReadPreviewBlock"}';
  const detail = Buffer.concat([Buffer.from(json), Buffer.from([0x0b]), Buffer.from('QUJDREVG')]);
  const frame = encodeFrame(TYPE.SUCCESS, 'PreviewWebtoonFromClient', 1, detail);
  const pkt = parseFrame(frame);
  assert.equal(pkt.rawDetail.toString('utf8'), json);
  assert.equal(pkt.data.toString('utf8'), 'QUJDREVG');
  assert.deepEqual(pkt.detail, { Operation: 'ReadPreviewBlock' });
});

test('splitFrames separates coalesced records and keeps the partial tail', () => {
  const a = encodeFrame(TYPE.CLIENT, 'TellHeartbeat', 1, null);
  const b = encodeFrame(TYPE.SUCCESS, 'Authenticate', 2, '{"AuthErrorReason":"Unknown"}');
  const partial = Buffer.from([TYPE.SUCCESS, 0x24, 0x61]);
  const { frames, rest } = splitFrames(Buffer.concat([a, b, partial]));
  assert.equal(frames.length, 2);
  assert.deepEqual(rest, partial);
  assert.equal(parseFrame(frames[1]).command, 'Authenticate');
});

test('parseFrame rejects malformed input', () => {
  assert.equal(parseFrame(Buffer.from('garbage')), null);
  assert.equal(parseFrame(Buffer.from([TYPE.SUCCESS])), null);
  const good = encodeFrame(TYPE.CLIENT, 'TellHeartbeat', 0, null);
  const noTerm = good.subarray(0, good.length - 1);
  assert.equal(parseFrame(noTerm), null);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isCompanionWindow } = require('../src/main/capture');

test('the Companion dialog title is recognised in every CSP language', () => {
  const titles = [
    'Connect to smartphone',      // en
    'スマートフォンを接続',           // ja
    'スマホに接続',                 // ja (short form)
    '스마트폰 접속',                 // ko
    '連接智慧型手機',                // zh-TW
    '连接智能手机',                  // zh-CN
    'Connecter au smartphone',    // fr
    'Mit Smartphone verbinden',   // de
    'Conectar a smartphone',      // es
    'Conectar ao smartphone',     // pt-BR
    'Hubungkan ke smartphone',    // id
  ];
  for (const title of titles) assert.equal(isCompanionWindow(title), true, title);
});

test('other windows are not mistaken for the Companion dialog', () => {
  assert.equal(isCompanionWindow('Clip Studio Paint'), false);
  assert.equal(isCompanionWindow('Iroiroppa'), false);
  assert.equal(isCompanionWindow(''), false);
  assert.equal(isCompanionWindow(undefined), false);
});

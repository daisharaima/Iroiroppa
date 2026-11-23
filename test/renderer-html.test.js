'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');

const pages = () => fs.readdirSync(RENDERER).filter((name) => name.endsWith('.html'));

test('every <script src> in a renderer page resolves to a file', () => {
  for (const page of pages()) {
    const html = fs.readFileSync(path.join(RENDERER, page), 'utf8');
    const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(srcs.length > 0, `${page} loads no scripts`);
    for (const src of srcs) {
      if (/^[a-z]+:/i.test(src)) continue;
      const target = path.resolve(RENDERER, src);
      assert.ok(fs.existsSync(target), `${page} loads ${src}, which does not exist`);
    }
  }
});

test('the module settings popup can build a grouped model list', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'module-settings.html'), 'utf8');
  assert.match(html, /<script[^>]+src="kernel\/model-options\.js"/,
    'module-settings.html must load kernel/model-options.js: the picker modules build '
    + 'their settings with it, and without it their settings section opens empty');

  assert.match(html, /<script[^>]+src="\.\.\/shared\/color-models\.js"/);
});

test('both pages that render a settingsUI load the model-options helper', () => {
  for (const page of ['module-settings.html', 'settings.html']) {
    const html = fs.readFileSync(path.join(RENDERER, page), 'utf8');
    assert.match(html, /<script[^>]+src="kernel\/model-options\.js"/,
      `${page} must load kernel/model-options.js`);

    assert.match(html, /<script[^>]+src="kernel\/tooltip\.js"/,
      `${page} must load kernel/tooltip.js`);
    assert.ok(!/\stitle="/.test(html), `${page} must not set native title tooltips`);
  }
});

test('ottosson.js loads before model-reference.js in every page', () => {
  for (const page of pages()) {
    const html = fs.readFileSync(path.join(RENDERER, page), 'utf8');
    const ottosson = html.indexOf('ottosson.js');
    const reference = html.indexOf('model-reference.js');
    if (reference < 0) continue;
    assert.ok(ottosson >= 0 && ottosson < reference, `${page}: ottosson.js must come first`);
  }
});

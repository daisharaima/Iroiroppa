'use strict';

// The renderer's HTML pages load their small "kernel" modules by hand; a wrong path
// or a missing <script> fails silently at runtime (an undefined global throws inside a
// module's settingsUI, leaving the popup empty). This test resolves every script tag
// against the page's own folder, and pins the one dependency that broke the module
// settings popup: it builds its model list through kernel/model-options.js.

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
      if (/^[a-z]+:/i.test(src)) continue; // module:/theme: URL schemes
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
  // The helper itself depends on the model registry being present in that page.
  assert.match(html, /<script[^>]+src="\.\.\/shared\/color-models\.js"/);
});

// The Settings window's Modules tab renders the same settingsUI, so it needs the same
// helper — it was missed once and left only the Module Size slider behind.
test('both pages that render a settingsUI load the model-options helper', () => {
  for (const page of ['module-settings.html', 'settings.html']) {
    const html = fs.readFileSync(path.join(RENDERER, page), 'utf8');
    assert.match(html, /<script[^>]+src="kernel\/model-options\.js"/,
      `${page} must load kernel/model-options.js`);
    // The info tooltips are drawn on the overlay (a native title would be an OS window
    // behind the always-on-top palettes).
    assert.match(html, /<script[^>]+src="kernel\/tooltip\.js"/,
      `${page} must load kernel/tooltip.js`);
    assert.ok(!/\stitle="/.test(html), `${page} must not set native title tooltips`);
  }
});

// The document-cube reference is built on the generalised Ottosson module, which has to
// load before it in every page that creates a reference.
test('ottosson.js loads before model-reference.js in every page', () => {
  for (const page of pages()) {
    const html = fs.readFileSync(path.join(RENDERER, page), 'utf8');
    const ottosson = html.indexOf('ottosson.js');
    const reference = html.indexOf('model-reference.js');
    if (reference < 0) continue;
    assert.ok(ottosson >= 0 && ottosson < reference, `${page}: ottosson.js must come first`);
  }
});

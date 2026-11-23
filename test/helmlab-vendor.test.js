'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const Helm = require('../src/renderer/vendor/helmlab/helmlab.umd.js');

test('the vendored bundle exposes the classes the app uses', () => {
  assert.equal(typeof Helm.Helmlab, 'function');
  assert.equal(typeof Helm.GenSpace, 'function');
  assert.equal(typeof Helm.MetricSpace, 'function');
  const hl = new Helm.Helmlab();
  assert.equal(typeof hl.gen.fromHex, 'function');
  assert.equal(typeof hl.metric.distance, 'function');
});

test('the vendored version matches the devDependency pin', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(Helm.VERSION, pkg.devDependencies.helmlab);
});

test('the vendor folder carries its licence', () => {
  const licence = path.join(__dirname, '..', 'src', 'renderer', 'vendor', 'helmlab', 'LICENSE');
  assert.ok(fs.existsSync(licence), 'MIT licence next to the bundle');
});

test('every page that loads the model registry loads the bundle first', () => {
  const dir = path.join(__dirname, '..', 'src', 'renderer');
  const pages = fs.readdirSync(dir).filter((name) => name.endsWith('.html'));
  let checked = 0;
  for (const name of pages) {
    const html = fs.readFileSync(path.join(dir, name), 'utf8');
    const models = html.indexOf('color-models.js');
    if (models < 0) continue;
    checked += 1;
    const helm = html.indexOf('helmlab.umd.js');
    assert.ok(helm >= 0 && helm < models, `${name} must load helmlab.umd.js before color-models.js`);
  }
  assert.ok(checked >= 4, `expected the four pages to load the registry, saw ${checked}`);
});

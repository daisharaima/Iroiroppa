'use strict';

// The vendored Helmlab bundle (scripts/vendor-helmlab.js) must load in Node and
// stay in step with the devDependency it is generated from, or the models would
// silently test against a different transform than the app ships.

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

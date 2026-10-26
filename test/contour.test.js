'use strict';

// Iso-lines of a lightness field (src/shared/contour.js). The guide must be exactly
// the set of pixels at one lightness, so these fixtures are fields whose contour is
// known: a ramp (a straight line), a radius (a closed loop), and a hole (a break).

const test = require('node:test');
const assert = require('node:assert');
const Contour = require('../src/shared/contour');

const ramp = (w, h) => {
  const f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = x;
  return f;
};

const radial = (w, h) => {
  const f = new Float32Array(w * h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[y * w + x] = Math.hypot(x - cx, y - cy);
  }
  return f;
};

test('a ramp gives one straight line at the target column', () => {
  const lines = Contour.isoLines(ramp(8, 5), 8, 5, 3.5);
  assert.equal(lines.length, 1);
  const pts = lines[0];
  for (const [x] of pts) assert.ok(Math.abs(x - 3.5) < 1e-9, `x ${x}`);
  const ys = pts.map((p) => p[1]);
  assert.ok(Math.min(...ys) <= 0.001, 'starts at the top edge');
  assert.ok(Math.max(...ys) >= 3.999, 'ends at the bottom edge');
});

test('a radial field gives a closed loop at the target radius', () => {
  const w = 21;
  const h = 21;
  const lines = Contour.isoLines(radial(w, h), w, h, 6.5);
  assert.equal(lines.length, 1);
  const pts = lines[0];
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  for (const [x, y] of pts) {
    const d = Math.hypot(x - cx, y - cy);
    assert.ok(Math.abs(d - 6.5) < 0.75, `radius ${d}`);
  }
  const [fx, fy] = pts[0];
  const [lx, ly] = pts[pts.length - 1];
  assert.ok(Math.hypot(fx - lx, fy - ly) < 1.5, 'the loop closes on itself');
});

test('unpainted (NaN) cells break the line there', () => {
  const w = 9;
  const h = 7;
  const f = ramp(w, h);
  // A two-row hole is a real gap in the painted shape: the line must stop at it.
  for (let x = 0; x < w; x++) { f[3 * w + x] = NaN; f[4 * w + x] = NaN; }
  const lines = Contour.isoLines(f, w, h, 3.5);
  assert.equal(lines.length, 2, 'two runs, one either side of the hole');
  const tops = lines.map((pts) => Math.min(...pts.map((p) => p[1])));
  const bottoms = lines.map((pts) => Math.max(...pts.map((p) => p[1])));
  assert.ok(Math.min(...tops) < 1, 'the upper run reaches the top edge');
  assert.ok(Math.max(...bottoms) > 5.9, 'the lower run reaches the bottom edge');
  for (const pts of lines) for (const [x] of pts) assert.ok(Math.abs(x - 3.5) < 1e-9);
});

test('the units are whatever the field carries (CIELAB L* 0..100)', () => {
  const w = 8;
  const h = 5;
  const f = ramp(w, h);
  for (let i = 0; i < f.length; i++) f[i] *= 25;
  // Same field, scaled: target 3.5 becomes 87.5 and the line stays at x = 3.5.
  const lines = Contour.isoLines(f, w, h, 87.5);
  assert.equal(lines.length, 1);
  for (const [x] of lines[0]) assert.ok(Math.abs(x - 3.5) < 1e-9);
});

test('a field with nothing painted yields no lines', () => {
  const f = new Float32Array(8 * 5).fill(NaN);
  assert.deepEqual(Contour.isoLines(f, 8, 5, 3.5), []);
  assert.deepEqual(Contour.isoLines(null, 8, 5, 3.5), []);
  assert.deepEqual(Contour.isoLines(ramp(1, 1), 1, 1, 0.5), []);
});

test('stride 2 still finds the contour', () => {
  const lines = Contour.isoLines(ramp(16, 9), 16, 9, 7.5, { stride: 2 });
  assert.equal(lines.length, 1);
  for (const [x] of lines[0]) assert.ok(Math.abs(x - 7.5) < 1.5);
});

test('a one-pixel unpainted speck does not break the guide in two', () => {
  const w = 9;
  const h = 6;
  const f = ramp(w, h);
  f[3 * w + 4] = NaN; // unpainted next to the line: two pieces without joining
  assert.equal(Contour.isoLines(f, w, h, 3.5, { gap: 0 }).length, 2);
  const joined = Contour.isoLines(f, w, h, 3.5);
  assert.equal(joined.length, 1);
  assert.ok(joined[0].length >= 5, 'the pieces are joined end to end');
});

test('a closed loop is never "joined" into itself', () => {
  const w = 41;
  const h = 41;
  const lines = Contour.isoLines(radial(w, h), w, h, 9.5);
  assert.equal(lines.length, 1);
  const pts = lines[0];
  assert.ok(Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01);
});

test('decimate keeps both ends and thins the middle', () => {
  const pts = [[0, 0], [0.2, 0], [0.4, 0], [5, 0], [10, 0]];
  const out = Contour.decimate(pts, 1);
  assert.deepEqual(out, [[0, 0], [5, 0], [10, 0]]);
  assert.deepEqual(Contour.decimate([[0, 0], [10, 0]], 1), [[0, 0], [10, 0]]);
});

test('an unbounded projection picks the nearest branch, not the first one', () => {
  // Two parallel branches: a locked drag must land on the one under the cursor.
  const lines = [[[-1, -1], [-1, 1]], [[1, -1], [1, 1]]];
  const right = Contour.nearestOnLines(lines, 0.9, 0.2, 8, 8);
  assert.ok(right, 'a hit at any distance');
  assert.ok(Math.abs(right.u - 1) < 1e-9, `the right branch, got u=${right.u}`);
  const left = Contour.nearestOnLines(lines, -0.9, 0.2, 8, 8);
  assert.ok(left && Math.abs(left.u + 1) < 1e-9, 'the left branch');
});

test('nearestOnLines projects a pointer onto the guide within its radius', () => {  const line = [[[0, 0], [10, 10]]];
  const hit = Contour.nearestOnLines(line, 6, 4, 2, 2);
  assert.ok(hit, 'within the ellipse');
  assert.ok(Math.abs(hit.u - 5) < 1e-9 && Math.abs(hit.v - 5) < 1e-9, 'projects onto the diagonal');
  assert.equal(Contour.nearestOnLines(line, 40, 40, 2, 2), null, 'far away is no hit');
  // Past the end, the nearest point is the endpoint itself (so a slice boundary is reachable).
  const end = Contour.nearestOnLines(line, 11, 10, 2, 2);
  assert.ok(end && Math.abs(end.u - 10) < 1e-9 && Math.abs(end.v - 10) < 1e-9);
  // The threshold is an ellipse in normalized units, so a non-square panel behaves.
  assert.equal(Contour.nearestOnLines(line, 6, 4, 0.5, 0.5), null);
  assert.equal(Contour.nearestOnLines([], 0, 0, 1, 1), null);
  assert.equal(Contour.nearestOnLines(line, 6, 4, 0, 1), null);
});

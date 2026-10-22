'use strict';

// Grid interpolation for the CMYK proof.

const test = require('node:test');
const assert = require('node:assert/strict');

const { interp, interp3, interp4 } = require('../src/shared/lut');

test('interp reproduces an identity 3D grid exactly', () => {
  const size = 4;
  const grid = new Float64Array(size * size * size * 3);
  for (let r = 0; r < size; r++) {
    for (let g = 0; g < size; g++) {
      for (let b = 0; b < size; b++) {
        const i = ((r * size) + g) * size + b;
        grid[i * 3] = r / (size - 1);
        grid[i * 3 + 1] = g / (size - 1);
        grid[i * 3 + 2] = b / (size - 1);
      }
    }
  }
  const out = interp(grid, size, 3, [0.25, 0.5, 0.75]);
  assert.ok(Math.abs(out[0] - 0.25) < 1e-12, 'first channel');
  assert.ok(Math.abs(out[1] - 0.5) < 1e-12, 'second channel');
  assert.ok(Math.abs(out[2] - 0.75) < 1e-12, 'third channel');
});

test('interp clamps out-of-range coordinates to the grid edges', () => {
  const grid = [0, 1, 0, 1];
  assert.deepEqual(interp(grid, 2, 2, [-0.5]), [0, 1]);
  assert.deepEqual(interp(grid, 2, 2, [1.5]), [0, 1]);
});

test('interp3/interp4 use the proof channel counts', () => {
  const g3 = new Float64Array(2 * 2 * 2 * 4).fill(0.5);
  assert.deepEqual(interp3(g3, 2, [0.5, 0.5, 0.5]), [0.5, 0.5, 0.5, 0.5]);
  const g4 = new Float64Array(2 * 2 * 2 * 2 * 3).fill(0.25);
  assert.deepEqual(interp4(g4, 2, [0, 1, 0, 1]), [0.25, 0.25, 0.25]);
});

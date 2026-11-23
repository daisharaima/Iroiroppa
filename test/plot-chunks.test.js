'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Chunks = require('../src/shared/plot-chunks.js');

test('bounds cover every row exactly once, in order', () => {
  for (const height of [1, 2, 3, 7, 24, 100, 257, 600, 1080]) {
    for (const chunks of [1, 2, 3, 4, 7]) {
      const ranges = Chunks.bounds(height, chunks);
      assert.ok(ranges.length > 0, `h=${height} c=${chunks} produced no chunk`);

      let expected = 0;
      for (const range of ranges) {
        assert.equal(range.start, expected, `h=${height} c=${chunks} gap or overlap`);
        assert.ok(range.end > range.start, 'empty chunk');
        assert.ok(range.end <= height, 'chunk past the end');
        expected = range.end;
      }
      assert.equal(expected, height, `h=${height} c=${chunks} did not cover the plane`);
    }
  }
});

test('the chunk count is bounded by the request', () => {
  for (const height of [24, 100, 600]) {
    for (const chunks of [1, 2, 3]) {
      const ranges = Chunks.bounds(height, chunks);

      assert.ok(ranges.length <= Math.max(1, chunks), `h=${height} c=${chunks} made ${ranges.length}`);
    }
  }
});

test('size never returns zero, whatever the input', () => {
  for (const [height, chunks] of [[0, 3], [1, 100], [600, 0], [-5, 3], [NaN, 3], [600, NaN]]) {
    const value = Chunks.size(height, chunks);
    assert.ok(Number.isInteger(value) && value >= 1, `${height}/${chunks} -> ${value}`);
  }
});

test('zero height means no chunks at all', () => {
  assert.deepEqual(Chunks.bounds(0, 3), []);
});

test('three chunks is what the builder asks for, and it is honoured', () => {
  const ranges = Chunks.bounds(600, 3);
  assert.equal(ranges.length, 3);
  assert.deepEqual(ranges[0], { start: 0, end: 200 });
  assert.deepEqual(ranges[2], { start: 400, end: 600 });
});

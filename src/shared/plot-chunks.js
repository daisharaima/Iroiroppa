
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroPlotChunks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Rows per chunk for a plane of `height` rows split into at most `chunks` chunks. */
  function size(height, chunks) {
    const rows = Math.max(1, Math.floor(Number(height) || 0));
    const parts = Math.max(1, Math.floor(Number(chunks) || 1));
    return Math.max(1, Math.ceil(rows / parts));
  }

  /**
   * The row ranges, in order, that cover `[0, height)` exactly once.
   * Never empty, never overlapping, never past the end.
   */
  function bounds(height, chunks) {
    const rows = Math.max(0, Math.floor(Number(height) || 0));
    if (rows === 0) return [];
    const step = size(rows, chunks);
    const out = [];
    for (let start = 0; start < rows; start += step) {
      out.push({ start, end: Math.min(rows, start + step) });
    }
    return out;
  }

  return { size, bounds };
});

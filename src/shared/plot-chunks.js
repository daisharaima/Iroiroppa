/*
 * Plane chunk arithmetic — how a plane's rows are split across animation frames.
 *
 * The chunked builder walks rows in order, writing each row exactly once and never
 * past the plane's height. That is the invariant the earlier implementation violated
 * when a row counter advanced before the row was written (every row landed one row
 * off) and is the reason a resize, a superseded build and a hidden page all have to
 * abandon the build rather than continue it.
 *
 * Pure and injected so it is unit-tested without a canvas.
 *
 * Loads as CommonJS in Node and as a global `IroPlotChunks` in the renderer.
 */
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

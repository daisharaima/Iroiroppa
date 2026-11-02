'use strict';

// The plane rasteriser, off the main thread (docs/PERF.md).
//
// A colour plane is a per-pixel conversion chain; on a heavy model it costs 44-53 ms
// and it ran on the main thread, so every rebuild cost up to three dropped frames
// (measured: 50-63 ms long tasks, one per ~150 ms of a drag). This worker runs the
// same shared code — `src/shared/raster-plane.js` is loaded verbatim — and returns the
// pixels, so the build costs wall time but no frames.
//
// A job carries only data: model id, plane index, fixed axes, ranges and the size.
// A predicate (the working-gamut test) cannot cross `postMessage`, so the client keeps
// those builds on the main thread.

/* global importScripts, self */

importScripts(
  '../../shared/color.js',
  '../../shared/color-models.js',
  '../../shared/raster-plane.js'
);

self.onmessage = (event) => {
  const job = event.data;
  if (!job || !job.id) return;

  try {
    const Raster = self.IroRasterPlane;
    const Models = self.IroColorModels;
    if (!Raster || typeof Raster.renderPlane !== 'function') {
      self.postMessage({ id: job.id, error: 'raster-plane-unavailable' });
      return;
    }

    const spec = job.spec;
    const width = spec.width;
    const height = spec.height;
    const data = new Uint8ClampedArray(width * height * 4);
    const luma = new Float32Array(width * height).fill(NaN);
    const model = (Models && (Models.get(spec.modelId) || Models.get(Models.DEFAULT_ID))) || { id: spec.modelId };

    const started = performance.now();
    Raster.renderPlane({
      model,
      plane: spec.plane,
      fixed: spec.fixed,
      ranges: spec.ranges,
      width,
      height,
      out: data,
      luma,
      workingGamut: null,
      fill: spec.fill === true,
      fillAlpha: spec.fillAlpha,
      outAlpha: spec.outAlpha,
    });
    const ms = performance.now() - started;

    self.postMessage({ id: job.id, data, luma, ms }, [data.buffer, luma.buffer]);
  } catch (error) {
    self.postMessage({ id: job.id, error: String((error && error.message) || error) });
  }
};

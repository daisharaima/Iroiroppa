'use strict';

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

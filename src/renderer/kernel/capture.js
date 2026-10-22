'use strict';

// Opens and samples a captured window in the renderer.
// Main lists the sources; this turns a source id into a MediaStream, draws frames
// to a canvas and reads a pixel back.

(function () {
  const csp = window.csp;

  /** The capturable windows (main enumerates them). Never throws. */
  async function sources() {
    try { return (await csp.captureSources()) || []; } catch { return []; }
  }

  /** A MediaStream for one window id (Electron desktop capture). */
  function open(sourceId) {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: String(sourceId),
          maxFrameRate: 30,
        },
      },
    });
  }

  /**
   * Draw the current video frame at natural size and read one pixel.
   * @returns {{r:number,g:number,b:number}|null}
   */
  function sample(video, canvas, x, y) {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(video, 0, 0, w, h);
    const px = Math.min(Math.max(Math.round(x), 0), w - 1);
    const py = Math.min(Math.max(Math.round(y), 0), h - 1);
    const d = g.getImageData(px, py, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  }

  window.Iro = window.Iro || {};
  window.Iro.capture = { sources, open, sample };
})();

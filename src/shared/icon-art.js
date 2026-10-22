/*
 * The app/tray icon, drawn in pure JS so the repo needs no binary asset and both
 * the 256 px exe icon and the 32 px tray icon share one design. A soft pastel
 * rounded square with one big centred "I"; no colour wheel.
 *
 * Loads as CommonJS in Node and as a global `IroIconArt` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroIconArt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const mix = (a, b, t) => Math.round(a + (b - a) * t);

  // Rounded-rectangle signed distance: <0 inside.
  function roundedRect(x, y, size, radius) {
    const cx = Math.abs(x - size / 2) - (size / 2 - radius);
    const cy = Math.abs(y - size / 2) - (size / 2 - radius);
    const dx = Math.max(cx, 0);
    const dy = Math.max(cy, 0);
    return Math.hypot(dx, dy) + Math.min(Math.max(cx, cy), 0) - radius;
  }

  /**
   * @param {number} size square edge in pixels
   * @returns {Uint8Array} RGBA, row-major
   */
  function drawIcon(size) {
    const n = Math.max(8, Math.round(size));
    const out = new Uint8Array(n * n * 4);
    const radius = n * 0.22;
    // Big capital I: a stem with wide top and bottom caps.
    const capW = n * 0.40;
    const capH = n * 0.095;
    const stemW = n * 0.135;
    const totalH = n * 0.58;
    const left = (n - capW) / 2;
    const right = (n + capW) / 2;
    const top = (n - totalH) / 2;
    const bottom = (n + totalH) / 2;
    const stemL = (n - stemW) / 2;
    const stemR = (n + stemW) / 2;
    const capT = [top, top + capH];
    const capB = [bottom - capH, bottom];

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        const px = x + 0.5;
        const py = y + 0.5;
        const d = roundedRect(px, py, n, radius);
        const edge = clamp01(0.5 - d); // 1 inside, 0 outside, a 1px AA band
        if (edge <= 0) continue;
        const t = clamp01((px + py) / (2 * n));
        out[i] = mix(246, 233, t);
        out[i + 1] = mix(234, 223, t);
        out[i + 2] = mix(231, 242, t);
        out[i + 3] = Math.round(edge * 255);

        const inCap = px >= left && px <= right
          && ((py >= capT[0] && py <= capT[1]) || (py >= capB[0] && py <= capB[1]));
        const inStem = px >= stemL && px <= stemR && py >= top && py <= bottom;
        if (inCap || inStem) {
          // A soft mauve "I"; the AA edge is handled by the rounded-rect alpha.
          out[i] = 126; out[i + 1] = 107; out[i + 2] = 142; out[i + 3] = 255;
        }
      }
    }
    return out;
  }

  /** Convert RGBA to the BGRA buffer Electron's createFromBitmap expects. */
  function rgbaToBgra(rgba) {
    const out = Buffer.alloc(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      out[i] = rgba[i + 2];
      out[i + 1] = rgba[i + 1];
      out[i + 2] = rgba[i];
      out[i + 3] = rgba[i + 3];
    }
    return out;
  }

  return { drawIcon, rgbaToBgra };
});

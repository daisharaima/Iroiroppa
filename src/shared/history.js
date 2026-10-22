'use strict';

// The shared colour-history rule . The list is a stack of quantized
// sRGB values; a new pick is dropped when it matches the head, and the list is
// capped. Pure, so both main and the tests share one definition.

/**
 * Quantize a colour to the 8-bit sRGB value the list stores.
 * @returns {{r:number,g:number,b:number}|null}
 */
function normalizeRgb(rgb) {
  if (!rgb || typeof rgb !== 'object') return null;
  if (!Number.isFinite(rgb.r) || !Number.isFinite(rgb.g) || !Number.isFinite(rgb.b)) return null;
  // Clamp before rounding: a channel of 255.6 (a float-literate caller, or a
  // weighted pick) must not store 256, and -0.4 must not store -0.
  const byte = (v) => Math.min(255, Math.max(0, Math.round(v)));
  return { r: byte(rgb.r), g: byte(rgb.g), b: byte(rgb.b) };
}

/**
 * Push `rgb` onto `list` (mutating it) unless it duplicates the head.
 * @returns {boolean} true when the list changed
 */
function addToHistory(list, rgb, max) {
  if (!Array.isArray(list)) return false;
  const next = normalizeRgb(rgb);
  if (!next) return false;
  const last = list[0];
  if (last && last.r === next.r && last.g === next.g && last.b === next.b) return false;
  list.unshift(next);
  if (Number.isFinite(max) && list.length > max) list.length = max;
  return true;
}

module.exports = { addToHistory, normalizeRgb };

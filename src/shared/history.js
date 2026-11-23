'use strict';

/**
 * Quantize a colour to the 8-bit sRGB value the list stores.
 * @returns {{r:number,g:number,b:number}|null}
 */
function normalizeRgb(rgb) {
  if (!rgb || typeof rgb !== 'object') return null;
  if (!Number.isFinite(rgb.r) || !Number.isFinite(rgb.g) || !Number.isFinite(rgb.b)) return null;

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

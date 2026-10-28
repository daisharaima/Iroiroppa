/*
 * Does the overlay still have an owner?
 *
 * The overlay is a full-desktop transparent window: leaving it visible when
 * nothing is drawn is the "model dropdown disappears" smell. But a drag chip,
 * drop line, snap line or the palette-merge confirmation all live on it and have
 * no menu/tooltip flag of their own. The band watch asks this predicate before
 * hiding it, so those interactions survive the 500 ms self-heal.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroOverlayOwnership = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function overlayShouldStay({ menu = false, tooltip = false, confirm = false, dragging = false, preview = false } = {}) {
    return Boolean(menu || tooltip || confirm || dragging || preview);
  }

  return { overlayShouldStay };
});

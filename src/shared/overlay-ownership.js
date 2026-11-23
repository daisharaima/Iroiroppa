
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

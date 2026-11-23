
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ottosson'));
  else root.IroModelReference = factory(root.IroOttosson);
})(typeof self !== 'undefined' ? self : this, function (Ottosson) {
  'use strict';

  const SRGB = { kind: 'srgb', limited: true, key: 'srgb' };

  const profileKey = (proof) => {
    const p = proof && proof.profile;
    if (!p) return 'profile';
    return p.name || p.description || p.path || p.id || 'profile';
  };

  /**
   * @param {object|null} proof the active proof (src/shared/proof.js)
   */
  function create(proof) {
    if (!proof || !proof.profile || !Ottosson) return SRGB;
    const key = profileKey(proof);

    if (proof.profile.colorants
      && typeof proof.oklabToLinearRecord === 'function'
      && typeof proof.linearRecordToOklab === 'function') {
      return {
        kind: 'document',
        limited: false,
        key: `document:${key}`,
        recordToOklab: (rgb) => proof.recordToOklab(rgb),
        oklabToRecord: (lab) => proof.oklabToRecord(lab),
        gamut: Ottosson.create({
          toLinear: (lab) => proof.oklabToLinearRecord(lab),
          fromLinear: (rgb) => proof.linearRecordToOklab(rgb),
        }),
      };
    }

    if (typeof proof.maxChroma === 'function') {
      return {
        kind: 'gamut',
        limited: false,
        key: `gamut:${key}`,
        gamut: Ottosson.gamutRelative({
          maxChroma: (L, H) => proof.maxChroma(L, H, 0.6),
        }),
      };
    }

    return SRGB;
  }

  /** A stable cache key: the reference changes when the profile (or its kind) does. */
  function keyOf(reference) {
    return (reference && reference.key) || 'srgb';
  }

  return { create, keyOf, SRGB };
});

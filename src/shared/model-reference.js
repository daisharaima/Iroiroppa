/*
 * The RGB cube (or the gamut) the HSV-shaped picker models are built on.
 *
 * OKHSV / OKHSL / OKHWB are HSV/HSL/HWB-shaped, and that shape is defined by an RGB
 * cube: S is the distance from the neutral axis to the cube's surface. Ottosson's
 * versions are the sRGB-specific ones, so they stop at the sRGB gamut and cannot name a
 * colour a wider document can hold.
 *
 * Two references replace that:
 *   - `document` — the active proof is a matrix/TRC RGB profile (Adobe RGB, P3,
 *     ProPhoto, …). `ottosson.create` computes the cusp and the boundary from that
 *     cube, so the three spaces are Ottosson's perceptual picks *inside the
 *     document's own cube*: S, V/W, B stay in 0..1 for every colour it holds.
 *   - `gamut` — a LUT/CMYK proof has no RGB cube (ink values, not RGB corners). S is
 *     then the fraction of the document gamut's chroma limit at the current lightness
 *     and hue (`ottosson.gamutRelative`), so every pick is a colour it can hold.
 *
 * Without a profile the sRGB reference is kept (Ottosson's sRGB definitions and the
 * "sRGB reference" notice).
 */
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

    // A matrix/TRC RGB profile has a cube: Ottosson over the document's own coordinates.
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

    // A LUT/CMYK proof has no cube: measure S against its own gamut boundary.
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

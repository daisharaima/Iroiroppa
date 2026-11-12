/*
 * Where a lens meets the profile.
 *
 * `src/shared/lens.js` is pure: it knows about bit grids and bands, not about documents.
 * This adapter is the one place that knows what "the document's channels" means, and it
 * is the only place that reads `store.proof`, so a module never has to.
 *
 * What the document's channels are (docs/COLOR.md):
 * - no profile         — the stored values are sRGB, so the band *is* the display colour;
 * - a matrix/TRC profile (Adobe RGB and friends) — the stored value is that profile's own
 *   R/G/B, and `appearanceSrgb` / `recordedSrgb` are the two exact directions;
 * - a LUT profile — a soft proof only: `createLutProof` records sRGB unchanged and routes
 *   the *appearance* through the LUT, so the grid is over sRGB and only the display goes
 *   through the proof (`.scratch/color-lens/DECISIONS.md`, B1).
 */
(function () {
  const reg = (window.Iro = window.Iro || {});

  /**
   * A module's settings carry the lens under `lens`; a lens object passed straight in is
   * already what `parseSpec` wants. Accepting both keeps the callers honest without each
   * of them having to remember which shape it holds.
   */
  function rawLens(settings) {
    if (!settings || typeof settings !== 'object') return null;
    if (settings.lens && typeof settings.lens === 'object') return settings.lens;
    return settings.active !== undefined || settings.quantize ? settings : null;
  }

  /** Build the lens for one selector instance, or null when it has none. */
  function build(store, lensSettings) {
    const Lens = window.IroLens;
    const Color = window.Color;
    if (!Lens || !Color) return null;
    const spec = Lens.parseSpec(rawLens(lensSettings));
    if (!spec.active) return null;

    const proof = store && store.proof ? store.proof : null;
    const opts = { bits: spec.bits };
    if (proof && proof.kind === 'lut') {
      // The document is sRGB; only the appearance goes through the proof.
      opts.fromDoc = (r, g, b) => proof.appearanceSrgb([r, g, b]);
      opts.docToLab = (r, g, b) => Color.rgbToOklab(r, g, b);
    } else if (proof) {
      opts.toDoc = (r, g, b) => proof.recordedSrgb([r, g, b]);
      opts.fromDoc = (r, g, b) => proof.appearanceSrgb([r, g, b]);
      if (typeof proof.recordToOklab === 'function') {
        opts.docToLab = (r, g, b) => proof.recordToOklab([r, g, b]);
      }
    }
    return Lens.create(opts);
  }

  /**
   * A key that changes exactly when the lens does: its bits, the profile identity and the
   * gamut. A module compares it to decide whether to rebuild and drop its cached planes.
   */
  function key(store, lensSettings) {
    const Lens = window.IroLens;
    const spec = Lens ? Lens.parseSpec(rawLens(lensSettings)) : { active: null, bits: [] };
    if (!spec.active) return 'none';
    const tag = store && typeof store.plotKeyTag === 'function' ? store.plotKeyTag() : 'srgb';
    return `quantize:${spec.bits.join('/')}:${tag}`;
  }

  reg.lensAccess = { build, key };
  // The selectors read it as a global (they are classic scripts, like every other shared
  // helper): one name, so a typo cannot silently switch every lens off.
  window.IroLensAccess = reg.lensAccess;
})();

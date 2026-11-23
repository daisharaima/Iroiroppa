
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

  window.IroLensAccess = reg.lensAccess;
})();

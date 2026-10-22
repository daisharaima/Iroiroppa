/*
 * The v1 column codec (plan: palette equality, P1).
 *
 * The board speaks schema-v1 columns: a module carries a `weight` (a share) and an
 * optional `ratio`. The document stores a v2 `height: { mode, value }`. This is
 * only that conversion — NOT the document-level v1 view (`columns` vs `floats`),
 * which is what made palette 0 special and is retired separately.
 *
 * v1 cannot *name* a height: `weight: null` means "the module's own default" and a
 * number is a share. So:
 *
 *   fill(N) <-> N            auto <-> null (when the stored height was auto)
 *   px(P)   <-> null (when the stored height was px)
 *
 * i.e. a px height reads back as null and a null write keeps the stored px, so a
 * round-trip is lossless for every document a v1 writer can produce.
 *
 * Pure and shared (UMD, loaded as a classic script in the renderers), so both a
 * board and main use the same code.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroLayoutCodec = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Mirrors layout-model's DEFAULT_WEIGHT (v1's default share).
  const DEFAULT_WEIGHT = 17;

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  /** v2 height -> v1 weight (null when v1 cannot express it: auto, px, ratio). */
  function heightToV1(height) {
    if (!height || height.mode !== 'fill') return null;
    return finite(height.weight) ?? DEFAULT_WEIGHT;
  }

  /** v2 height -> the v1 `ratio` field (null unless the mode is ratio). */
  function heightRatioToV1(height) {
    return height && height.mode === 'ratio' && finite(height.ratio) ? height.ratio : null;
  }

  /**
   * v1 weight -> v2 height. `stored` is the height the module has now, so an
   * unexpressible (`auto`/`px`) height survives a v1 write untouched.
   */
  function heightFromV1(weight, stored, registry, moduleId) {
    const share = finite(weight);
    if (share != null) return { mode: 'fill', weight: share > 0 ? share : DEFAULT_WEIGHT };
    if (stored && (stored.mode === 'auto' || stored.mode === 'px' || stored.mode === 'ratio')) return { ...stored };
    const def = registry ? registry[moduleId] : null;
    if (def && def.defaultRatio) return { mode: 'ratio', ratio: def.defaultRatio };
    return def && def.autoHeight ? { mode: 'auto' } : { mode: 'fill', weight: DEFAULT_WEIGHT };
  }

  /** A v1 module entry's height: an explicit `ratio` wins, else the weight/stored rules. */
  function heightEntryFromV1(m, stored, registry, moduleId) {
    const ratio = finite(m && m.ratio);
    if (ratio && ratio > 0) return { mode: 'ratio', ratio };
    return heightFromV1(m && m.weight, stored, registry, moduleId);
  }

  /** A palette's columns as v1. */
  function columnsToV1(palette) {
    return ((palette && palette.columns) || []).map((column) => ({
      id: column.id,
      width: column.width,
      modules: column.modules.map((m) => ({
        instanceId: m.instanceId,
        moduleId: m.moduleId,
        weight: heightToV1(m.height),
        ratio: heightRatioToV1(m.height),
      })),
    }));
  }

  /** A v1 column list as v2 columns, keeping any height v1 cannot express. */
  function columnsFromV1(columns, storedColumns, ctx) {
    const stored = new Map();
    for (const column of storedColumns || []) {
      for (const m of column.modules) stored.set(m.instanceId, m.height);
    }
    return (columns || []).map((column) => {
      const storedCol = (storedColumns || []).find((c) => String(c.id) === String(column && column.id));
      // A v1 write whose module entries carry no instance id must not mint a fresh one for
      // every save. Only when the incoming column is the *same set* of modules as the stored
      // one (same length, same module ids, in order) do we borrow the stored ids, so a
      // module that is genuinely being added still gets its own id.
      const incoming = (column && column.modules) || [];
      const sameShape = Boolean(storedCol) && storedCol.modules.length === incoming.length
        && storedCol.modules.every((x, i) => x.moduleId === String(incoming[i] && incoming[i].moduleId));
      return {
        id: column && column.id != null ? String(column.id) : ctx.newId('c'),
        width: finite(column && column.width) > 0 ? column.width : null,
        modules: incoming
          .filter((m) => m && m.moduleId)
          .map((m, index) => {
            let instanceId = m.instanceId != null ? String(m.instanceId) : null;
            if (!instanceId && sameShape) instanceId = storedCol.modules[index].instanceId;
            return {
              instanceId: instanceId || ctx.newId('i'),
              moduleId: String(m.moduleId),
              height: heightEntryFromV1(m, stored.get(String(instanceId)), ctx.registry, m.moduleId),
            };
          }),
      };
    });
  }

  return { DEFAULT_WEIGHT, finite, heightToV1, heightRatioToV1, heightFromV1, heightEntryFromV1, columnsToV1, columnsFromV1 };
});

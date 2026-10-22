'use strict';

// The per-domain view adapters (docs/STATE.md, §12.2). Each is pure: it takes a
// canonical snapshot and applies it to an existing store or handler. This is the
// one place the model meets the UI, so a window never hand-mirrors a channel.
//
// `history` is a token domain: main publishes it as a DTCG colour collection and
// these helpers convert it to and from the `{ r, g, b }` list the ColorStore uses.
// The conversion goes through shared/color.js, so the hex conventions (0–255 vs
// 0–1) are respected in one place.

(function () {
  const state = window.Iro && window.Iro.state;
  const Schema = window.IroTokenSchema;
  const Color = window.Color;

  const HISTORY_COLLECTION = 'history:iroiroppa';

  /** `[{ r, g, b }]` → a token payload (main-side shape, mirrored here for tests). */
  function rgbToTokens(list) {
    const tokens = (list || []).map((c, i) => ({
      name: `color/${String(i + 1).padStart(2, '0')}`,
      type: 'color',
      value: Color.rgbToHex(c.r, c.g, c.b),
    }));
    return { collections: [{ name: HISTORY_COLLECTION, modes: [{ name: 'Value', tokens }] }] };
  }

  /** A token payload → `[{ r, g, b }]`, order preserved. */
  function tokensToRgb(payload) {
    const out = [];
    for (const entry of Schema.extractColorTokens(payload)) {
      const rgb = Color.hexToRgb(entry.hex);
      if (rgb) out.push({ r: rgb.r, g: rgb.g, b: rgb.b });
    }
    return out;
  }

  window.Iro.stateAdapters = {
    rgbToTokens,
    tokensToRgb,
    /** capabilities: drive the renderer's capability store. */
    capabilities: (store) => state.register('capabilities', (v) => store.set(v)),
    /** connection: main's status object → the status UI. */
    connection: (apply) => state.register('connection', (v) => apply(v)),
    /** color: the incoming Companion colour → the store's mirror. */
    color: (apply) => state.register('color', (v) => apply(v)),
    /** history: the token collection → the ColorStore's history list. */
    history: (store) => state.register('history', (v) => store.setHistory(tokensToRgb(v))),
    /**
     * layout: the window's *own* palette, already codec'd to v1 columns. The domain
     * carries the whole v2 document; a window never needs another palette's columns,
     * and resolving its own here is what keeps every palette equal (plan P5).
     */
    layout: (apply) => state.register('layout', (doc) => {
      const id = window.csp && window.csp.paletteId;
      const palette = ((doc && doc.palettes) || []).find((p) => p.id === id);
      if (!palette) return;
      apply({
        version: 1,
        columns: window.IroLayoutCodec.columnsToV1(palette),
        // The window's own palette state: the titlebar's Unsnap icon and the name live
        // here, not in the columns (main owns both).
        palette: {
          id: palette.id,
          name: palette.name,
          snap: palette.snap || null,
          snapTo: palette.snapTo || null,
          hasFollowers: ((doc && doc.palettes) || []).some((p) => p.snap && p.snapTo === palette.id),
          collapsed: Boolean(palette.collapsed),
        },
      });
    }),
    /** health: the app's observable failure state (CSP, compute host, secrets). */
    health: (fn) => state.register('health', fn),
  };
})();

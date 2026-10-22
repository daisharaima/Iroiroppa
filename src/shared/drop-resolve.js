/*
 * Where a dragged payload would land.
 *
 * The plan (docs/LAYOUT.md, V4) requires one resolver to drive both the drop
 * indicator and the commit, so the picture can never disagree with the outcome.
 * This is it: pure, no Electron, shared so main and a board can call the same
 * function.
 *
 * Units: the point and each pane's `rect`/`zoom` are in the window layer's units
 * (screen DIP). Everything inside a pane is CSS pixels, as in the document, so
 * this is the one place that converts — `local = (point - rect.origin) / zoom`.
 *
 * Geometry: a pane may carry `boxes` — what the board actually drew, in pane-local
 * CSS pixels:
 *
 *   boxes: { columns: [ { columnId, left, width, modules: [ { instanceId, top, height } ] } ] }
 *
 * That is preferred, because the model and the render can drift (which is why the
 * old code probed a float's live columns with `executeJavaScript`). `columns` (the
 * document's own shape) plus `measured` natural heights is the fallback for a pane
 * that has not reported yet, and it is computed with layout-geometry — the same
 * function the board draws with.
 *
 * Overlap: the caller orders `panes` most-recently-interacted first; that order
 * *is* the rule for which window is on top (see docs/LAYOUT.md).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./layout-geometry'));
  } else {
    root.IroDropResolve = factory(root.IroLayoutGeometry);
  }
})(typeof self !== 'undefined' ? self : this, function (Geometry) {
  'use strict';

  // Fallbacks only: a pane that reports its own `boxes`/`pad`/`divider`/`gap` wins.
  // These mirror the board's CSS (src/renderer/style.css: the board padding, the
  // divider and the module gap are all 2 px).
  const DEFAULTS = {
    pad: 2,           // the board's inset inside the window, CSS px
    divider: 2,       // the gap between columns, CSS px
    gap: 2,           // the gap between modules, CSS px
    edgeBand: 30,     // the band at a window's left/right edge that means "new column"
    seamGrab: 7,      // how far either side of a column boundary counts as the seam
    minColumn: 10,
  };

  function opts(o) {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = o && Number.isFinite(o[k]) ? o[k] : DEFAULTS[k];
    return out;
  }

  function contains(rect, x, y) {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  }

  /** The pane's columns as { columnId, left, width, modules:[{instanceId,top,height}] }. */
  function spansFor(pane, boardW, boardH, o) {
    const reported = pane.boxes && Array.isArray(pane.boxes.columns) ? pane.boxes.columns : null;
    if (reported && reported.length) {
      return {
        reported: true,
        spans: reported.map((c) => ({
          columnId: c.columnId,
          left: Number(c.left) || 0,
          width: Number(c.width) || 0,
          modules: (Array.isArray(c.modules) ? c.modules : []).map((m) => ({
            instanceId: m.instanceId,
            top: Number(m.top) || 0,
            height: Number(m.height) || 0,
          })),
        })),
      };
    }
    // Fallback: the document plus the module shapes, laid out by the very same
    // geometry the board uses.
    const pad = Number.isFinite(pane.pad) ? pane.pad : o.pad;
    const geo = {
      pad,
      divider: Number.isFinite(pane.divider) ? pane.divider : o.divider,
      gap: Number.isFinite(pane.gap) ? pane.gap : o.gap,
      minColumn: o.minColumn,
    };
    const columns = Array.isArray(pane.columns) ? pane.columns : [];
    const widths = Geometry.columnWidths(columns, boardW, geo);
    const spans = [];
    let cursor = pad;
    for (let i = 0; i < columns.length; i += 1) {
      const width = widths[i] ? widths[i].width : o.minColumn;
      const rects = Geometry.moduleRects(columns[i], boardH - pad * 2, pane.measured || {}, geo);
      spans.push({
        columnId: columns[i].id,
        left: cursor,
        width,
        modules: rects.map((r) => ({ instanceId: r.instanceId, top: r.top + pad, height: r.height })),
      });
      cursor += width + geo.divider;
    }
    return { reported: false, spans };
  }

  /** The insertion index in a column: the first module whose middle is below y. */
  function indexIn(modules, y) {
    for (let i = 0; i < modules.length; i += 1) {
      if (y < modules[i].top + modules[i].height / 2) return i;
    }
    return modules.length;
  }

  /** The y of the boundary before `index`, taken from the modules as drawn. */
  function boundaryIn(modules, index) {
    if (!modules.length) return 0;
    if (index <= 0) return modules[0].top;
    if (index >= modules.length) {
      const last = modules[modules.length - 1];
      return last.top + last.height;
    }
    const above = modules[index - 1];
    return (above.top + above.height + modules[index].top) / 2;
  }

  /**
   * Resolve a drop.
   *
   * `input = { point, panes: [...] }` where a pane is
   *   { paletteId, rect:{x,y,width,height}, zoom, boxes?, columns?, measured?, pad?,
   *     divider?, gap? }
   *
   * Returns `null` when there is nothing to resolve, else one of
   *   { kind:'desktop' }
   *   { kind:'column',  paletteId, columnId, index, line:{x,y,length,axis} }
   *   { kind:'seam',    paletteId, seamIndex,     line:{x,y,length,axis} }
   *   { kind:'outer',   paletteId, side,          line:{x,y,length,axis} }
   * with the line in the pane's local CSS pixels (the overlay converts to DIP).
   */
  function resolveDrop(input, options) {
    const o = opts(options);
    if (!input || !input.point || !Array.isArray(input.panes)) return null;
    const { x, y } = input.point;

    const pane = input.panes.find((p) => p && p.rect && contains(p.rect, x, y));
    if (!pane) return input.allowDesktop === false ? null : { kind: 'desktop', line: null };

    const zoom = Number.isFinite(pane.zoom) && pane.zoom > 0 ? pane.zoom : 1;
    const local = { x: (x - pane.rect.x) / zoom, y: (y - pane.rect.y) / zoom };
    const boardW = pane.rect.width / zoom;
    const boardH = pane.rect.height / zoom;
    const pad = Number.isFinite(pane.pad) ? pane.pad : o.pad;
    const { spans } = spansFor(pane, boardW, boardH, o);

    if (!spans.length) {
      // An empty palette is a drop zone: its single column takes the module at the top.
      const columnId = pane.columns && pane.columns[0] ? pane.columns[0].id : null;
      return {
        kind: 'column',
        paletteId: pane.paletteId,
        columnId,
        index: 0,
        line: { x: pad, y: HEADER + pad, length: Math.max(0, boardW - pad * 2), axis: 'h' },
      };
    }

    // One column per palette: a drop anywhere in the pane lands in the column at the
    // y-index under the pointer, and the indicator is the horizontal insertion line.
    // There is no outer-edge/seam target any more — it asked for a second column the
    // board then collapsed, which also left the palette's minimum size wrong.
    const span = spans.find((sp) => local.x >= sp.left && local.x <= sp.left + sp.width)
      || (local.x < spans[0].left ? spans[0] : spans[spans.length - 1]);
    const index = indexIn(span.modules, local.y);
    return {
      kind: 'column',
      paletteId: pane.paletteId,
      columnId: span.columnId,
      index,
      line: { x: span.left, y: boundaryIn(span.modules, index), length: span.width, axis: 'h' },
    };
  }

  // The indicator must span the *content*, not the chrome: every palette has a 24 px
  // titlebar (style.css) and a bottom bar, and a vertical line that crosses them reads as
  // if the whole window were the target.
  const HEADER = 24;

  /** The `layout.place` target for a resolved plan — one vocabulary, one reducer. */
  function toPlaceTarget(plan) {
    if (!plan) return null;
    if (plan.kind === 'column') return { kind: 'column', paletteId: plan.paletteId, columnId: plan.columnId, index: plan.index };
    if (plan.kind === 'seam') return { kind: 'seam', paletteId: plan.paletteId, seamIndex: plan.seamIndex };
    if (plan.kind === 'outer') return { kind: 'outer', paletteId: plan.paletteId, side: plan.side };
    if (plan.kind === 'desktop') return { kind: 'desktop' };
    return null;
  }

  return { resolveDrop, toPlaceTarget, DEFAULTS };
});

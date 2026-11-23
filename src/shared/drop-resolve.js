
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./layout-geometry'));
  } else {
    root.IroDropResolve = factory(root.IroLayoutGeometry);
  }
})(typeof self !== 'undefined' ? self : this, function (Geometry) {
  'use strict';

  const DEFAULTS = {
    pad: 2,
    divider: 2,
    gap: 2,
    edgeBand: 30,
    seamGrab: 7,
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

      const columnId = pane.columns && pane.columns[0] ? pane.columns[0].id : null;
      return {
        kind: 'column',
        paletteId: pane.paletteId,
        columnId,
        index: 0,
        line: { x: pad, y: HEADER + pad, length: Math.max(0, boardW - pad * 2), axis: 'h' },
      };
    }

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

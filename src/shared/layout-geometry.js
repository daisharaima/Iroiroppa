/*
 * Board geometry, pure. Given a palette document and a map of measured content
 * heights it answers three questions, and nothing else:
 *
 *   - how wide is each column?          `columnWidths`
 *   - how tall is each module?          `moduleRects`
 *   - how big should the window be?     `contentSize` / `minSize` / `grownSize`
 *
 * The invariants live here, once:
 *   - a column always fills its window height and never scrolls;
 *   - nothing may leave empty space: leftover height goes to the `fill`
 *     modules (shared by weight), and if a column has none the *last* module
 *     absorbs it (so a module alone in a column always fills it);
 *   - a module's `px` height and an `auto` module's measured height are never
 *     traded away.
 *
 * Loads as CommonJS in Node and as a global `IroLayoutGeometry` in the renderer,
 * so the board and main size the same things the same way.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroLayoutGeometry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Board padding, the divider between columns, and the gap between modules.
   *  These mirror the CSS in src/renderer/style.css. */
  // These must match the board's CSS (src/renderer/style.css: `#board` padding,
  // the divider and the module gap are all 2 px). A board that reports its own
  // `boxes`/`pad` wins over these anyway (see resolveDrop).
  const DEFAULTS = {
    pad: 2,           // the board's inset inside the window, CSS px
    divider: 2,       // the gap between columns, CSS px
    gap: 2,           // the gap between modules, CSS px
    minColumn: 10,
    minModule: 11,
    defaultColumnWidth: 260,
    defaultModuleHeight: 60,
    minPalette: { width: 200, height: 340 },
    // The palette's own chrome (titlebar, status bar) that surrounds the board.
    // Zero here because the board measures itself; main injects the real box.
    chrome: { width: 0, height: 0 },
  };

  function optsOf(opts) {
    const o = opts || {};
    return {
      pad: finite(o.pad) ?? DEFAULTS.pad,
      divider: finite(o.divider) ?? DEFAULTS.divider,
      gap: finite(o.gap) ?? DEFAULTS.gap,
      minColumn: finite(o.minColumn) ?? DEFAULTS.minColumn,
      minModule: finite(o.minModule) ?? DEFAULTS.minModule,
      defaultColumnWidth: finite(o.defaultColumnWidth) ?? DEFAULTS.defaultColumnWidth,
      defaultModuleHeight: finite(o.defaultModuleHeight) ?? DEFAULTS.defaultModuleHeight,
      minPalette: o.minPalette || DEFAULTS.minPalette,
      chrome: o.chrome || DEFAULTS.chrome,
    };
  }

  /** The board's own box: the palette's CSS size minus its chrome. */
  function boardBox(palette, opts) {
    const o = optsOf(opts);
    const size = (palette && palette.size) || {};
    return {
      width: Math.max(0, (finite(size.width) || 0) - (finite(o.chrome.width) || 0)),
      height: Math.max(0, (finite(size.height) || 0) - (finite(o.chrome.height) || 0)),
    };
  }

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  const round = (n) => Math.round(n);

  /** Share `space` between `weights` so the parts sum to `space` exactly (the
   *  last part takes the rounding remainder — a 1 px gap is a visible seam). */
  function share(space, weights) {
    const total = weights.reduce((sum, w) => sum + w, 0) || 1;
    const parts = [];
    let used = 0;
    for (let i = 0; i < weights.length; i++) {
      if (i === weights.length - 1) {
        parts.push(Math.max(0, space - used));
      } else {
        const part = Math.max(0, round((space * weights[i]) / total));
        parts.push(part);
        used += part;
      }
    }
    return parts;
  }

  /**
   * Column widths for a palette content width.
   * An explicit `width` is kept; `null` columns share what is left.
   * @returns {Array<{columnId:string, width:number, fill:boolean}>}
   */
  function columnWidths(columns, totalWidth, opts) {
    const o = optsOf(opts);
    const list = Array.isArray(columns) ? columns : [];
    if (!list.length) return [];
    const inner = Math.max(0, totalWidth - o.pad * 2 - o.divider * (list.length - 1));
    // A lone column always fills the board: with nothing to trade against, a
    // stored width could only leave a gap beside it (the v1 file has exactly
    // that — a 133 px column inside a 200 px palette).
    if (list.length === 1) {
      return [{ columnId: list[0].id, width: Math.max(o.minColumn, inner), fill: true }];
    }
    const explicit = list.map((c) => finite(c.width));
    const fixedSum = explicit.reduce((sum, w) => sum + (w || 0), 0);
    const flexIdx = [];
    list.forEach((c, i) => {
      if (explicit[i] == null) flexIdx.push(i);
    });
    const remaining = Math.max(o.minColumn * flexIdx.length, inner - fixedSum);
    const parts = share(remaining, flexIdx.map(() => 1));
    const widths = list.map((c, i) => {
      if (explicit[i] != null) return Math.max(o.minColumn, round(explicit[i]));
      return Math.max(o.minColumn, parts[flexIdx.indexOf(i)]);
    });
    const total = widths.reduce((sum, w) => sum + w, 0);
    if (inner > 0 && total > inner) {
      const k = inner / total;
      for (let i = 0; i < widths.length; i++) widths[i] = Math.max(o.minColumn, round(widths[i] * k));
    }
    return list.map((c, i) => ({ columnId: c.id, width: widths[i], fill: explicit[i] == null }));
  }

  /** A module's own height: explicit `px`, else the measured content height. */
  function naturalHeight(module, measured, o) {
    if (module.height && module.height.mode === 'px') return Math.max(0, module.height.px);
    const map = measured || {};
    const value = finite(map[module.instanceId]);
    if (value != null) return Math.max(0, value);
    return o.defaultModuleHeight;
  }

  const isFill = (module) => Boolean(module.height) && module.height.mode === 'fill';
  const weightOf = (module) => {
    const w = finite(module.height && module.height.weight);
    return w && w > 0 ? w : 1;
  };

  /**
   * Module heights and offsets for one column.
   * @returns {Array<{instanceId:string, top:number, height:number, mode:string}>}
   */
  function moduleRects(column, totalHeight, measured, opts) {
    const o = optsOf(opts);
    const modules = column && Array.isArray(column.modules) ? column.modules : [];
    if (!modules.length) return [];
    const inner = Math.max(0, totalHeight - o.gap * (modules.length - 1));

    const fills = modules.filter(isFill);
    // No fill module: the last one absorbs the leftover, so a lone module (or a
    // column of only natural modules) still fills its box.
    const stretchLast = fills.length === 0 ? modules.length - 1 : -1;

    const fixedSum = modules.reduce(
      (sum, m, i) => sum + (isFill(m) || i === stretchLast ? 0 : naturalHeight(m, measured, o)),
      0,
    );
    const leftover = Math.max(0, inner - fixedSum);

    const fillIdx = fills.map((m) => modules.indexOf(m));
    const fillParts = share(leftover, fills.map(weightOf));

    const heights = modules.map((m, i) => {
      if (isFill(m)) return fillParts[fillIdx.indexOf(i)];
      if (i === stretchLast) return Math.max(0, leftover);
      return round(naturalHeight(m, measured, o));
    });

    let top = 0;
    return modules.map((m, i) => {
      const rect = { instanceId: m.instanceId, top, height: heights[i], mode: (m.height && m.height.mode) || 'auto' };
      top += heights[i] + o.gap;
      return rect;
    });
  }

  /** What a palette wants to be when every column is a single `auto` module:
   *  the bare-card float, generalised. */
  function contentSize(palette, measured, opts) {
    const o = optsOf(opts);
    const chrome = o.chrome;
    const columns = palette && Array.isArray(palette.columns) ? palette.columns : [];
    if (!columns.length) {
      return { width: o.defaultColumnWidth + o.pad * 2 + chrome.width, height: o.minPalette.height };
    }
    const widths = columns.map((c) => finite(c.width) || o.defaultColumnWidth);
    const heights = columns.map((c) => {
      const modules = c.modules;
      if (!modules.length) return 0;
      return modules.reduce((sum, m) => sum + naturalHeight(m, measured, o), 0) + o.gap * (modules.length - 1);
    });
    return {
      width: round(widths.reduce((sum, w) => sum + w, 0) + o.divider * (columns.length - 1) + o.pad * 2 + chrome.width),
      height: round(Math.max(...heights) + o.pad * 2 + chrome.height),
    };
  }

  /** True when the palette shrink-wraps: every column holds one `auto` module. */
  function isContentFit(palette) {
    const columns = palette && Array.isArray(palette.columns) ? palette.columns : [];
    if (!columns.length) return false;
    return columns.every((c) => c.modules.length === 1 && c.modules[0].height && c.modules[0].height.mode === 'auto');
  }

  /**
   * The smallest size that clips nothing. `moduleMins` maps an instanceId to the
   * `minSize()` its module reports (width/height).
   * @returns {{width:number, height:number}}
   */
  function minSize(palette, moduleMins, opts) {
    const o = optsOf(opts);
    const columns = palette && Array.isArray(palette.columns) ? palette.columns : [];
    const mins = moduleMins || {};
    if (!columns.length) return { width: o.minPalette.width, height: o.minPalette.height };
    let width = o.pad * 2 + o.divider * (columns.length - 1);
    let height = 0;
    for (const column of columns) {
      if (!column.modules.length) return { width: o.minPalette.width, height: o.minPalette.height };
      let columnHeight = o.gap * (column.modules.length - 1);
      let columnWidth = 0;
      for (const m of column.modules) {
        const min = mins[m.instanceId] || {};
        columnHeight += Math.max(o.minModule, finite(min.height) ?? o.minModule);
        columnWidth = Math.max(columnWidth, finite(min.width) ?? 0);
      }
      width += Math.max(o.minColumn, finite(column.width) || Math.max(columnWidth, o.defaultColumnWidth));
      height = Math.max(height, columnHeight);
    }
    return {
      width: round(Math.max(o.minPalette.width, width + o.chrome.width)),
      height: round(Math.max(o.minPalette.height, height + o.pad * 2 + o.chrome.height)),
    };
  }

  /**
   * The size after a structural change.
   *   change {kind:'grow'}                      never shrinks (the default)
   *   change {kind:'columns-added', px}         grows the width by `px`
   *   change {kind:'content'}                   grows to fit the content
   *   change {kind:'content-fit'}               shrink-wraps to the content
   */
  function grownSize(palette, change, measured, moduleMins, opts) {
    const o = optsOf(opts);
    const kind = (change && change.kind) || 'grow';
    const min = minSize(palette, moduleMins, o);
    const current = {
      width: finite(palette && palette.size && palette.size.width) || o.minPalette.width,
      height: finite(palette && palette.size && palette.size.height) || o.minPalette.height,
    };
    if (kind === 'content-fit') return contentSize(palette, measured, o);
    let width = Math.max(current.width, min.width);
    let height = Math.max(current.height, min.height);
    if (kind === 'columns-added') width = Math.max(width, current.width + (finite(change.px) || 0));
    if (kind === 'content') {
      const content = contentSize(palette, measured, o);
      width = Math.max(width, content.width);
      height = Math.max(height, content.height);
    }
    return { width: round(width), height: round(height) };
  }

  /**
   * Put `follower` flush against `anchor` on `side` (the side of the anchor the
   * follower sits on), keeping the follower's size and its perpendicular position.
   * This is the move rule for a snap group; the resize rule is `reflowSnapResize`.
   * @returns {{x:number,y:number,width:number,height:number}}
   */
  function snapFlush(anchor, follower, side) {
    const out = {
      x: follower.x,
      y: follower.y,
      width: follower.width,
      height: follower.height,
    };
    if (side === 'left') out.x = anchor.x - follower.width;
    else if (side === 'right') out.x = anchor.x + anchor.width;
    else if (side === 'top') out.y = anchor.y - follower.height;
    else if (side === 'bottom') out.y = anchor.y + anchor.height;
    return out;
  }

  /**
   * The shared edge of a snap group, as a splitter.
   *
   * When either window is resized, the edge that touches its neighbour is moved by
   * the OS; the other window is then adjusted so the pair stays flush and its own
   * outer edge stays where it was. Resizing an outer edge is a no-op here (the
   * neighbour is untouched). Both windows are clamped to their minimums; if a
   * minimum stops the splitter, the resized window is pulled back so no gap opens.
   *
   * `side` is the follower's `snap` (which side of the anchor it sits on).
   * `resizedRole` says which of the two the OS resized.
   * All rects are `{x,y,width,height}` in the same unit (screen DIP in main).
   *
   * @returns {{anchor:object, follower:object, changed:boolean}}
   */
  function reflowSnapResize(spec) {
    const s = spec || {};
    const side = s.side;
    const resizedRole = s.resizedRole === 'follower' ? 'follower' : 'anchor';
    if (!['left', 'right', 'top', 'bottom'].includes(side)) {
      return { anchor: s.anchor, follower: s.follower, changed: false };
    }
    const horizontal = side === 'left' || side === 'right';
    const anchor = { ...(s.anchor || {}) };
    const follower = { ...(s.follower || {}) };
    const prevAnchor = s.prevAnchor || anchor;
    const prevFollower = s.prevFollower || follower;
    const minAnchor = Math.max(1, finite(s.minAnchor) || 1);
    const minFollower = Math.max(1, finite(s.minFollower) || 1);
    const key = horizontal ? 'x' : 'y';
    const sizeKey = horizontal ? 'width' : 'height';
    const startOf = (r) => r[key];
    const endOf = (r) => r[key] + r[sizeKey];
    // The touching edge of each window on the shared axis.
    const anchorEdge = (r) => (side === 'right' || side === 'bottom' ? endOf(r) : startOf(r));
    const followerEdge = (r) => (side === 'right' || side === 'bottom' ? startOf(r) : endOf(r));
    // The far (outer) edge of each window: it must stay fixed.
    const anchorFar = (r) => (side === 'right' || side === 'bottom' ? startOf(r) : endOf(r));
    const followerFar = (r) => (side === 'right' || side === 'bottom' ? endOf(r) : startOf(r));
    const sharedMoved = resizedRole === 'follower'
      ? followerEdge(follower) !== followerEdge(prevFollower)
      : anchorEdge(anchor) !== anchorEdge(prevAnchor);
    if (!sharedMoved) return { anchor: s.anchor, follower: s.follower, changed: false };

    // The shared position the pointer asked for.
    let shared = resizedRole === 'follower' ? followerEdge(follower) : anchorEdge(anchor);

    if (resizedRole === 'follower') {
      // Move the anchor's touching edge to the new shared position.
      const anchorFarEdge = anchorFar(anchor);
      let size;
      if (side === 'right' || side === 'bottom') {
        size = shared - anchorFarEdge;
        if (size < minAnchor) { size = minAnchor; shared = anchorFarEdge + minAnchor; }
        anchor[sizeKey] = size;
      } else {
        size = anchorFarEdge - shared;
        if (size < minAnchor) { size = minAnchor; shared = anchorFarEdge - minAnchor; }
        anchor[key] = shared;
        anchor[sizeKey] = size;
      }
      // Keep the follower's outer edge fixed and put its touching edge back on the
      // (possibly clamped) shared position.
      const far = followerFar(follower);
      if (side === 'right' || side === 'bottom') {
        follower[key] = shared;
        follower[sizeKey] = far - shared;
      } else {
        follower[sizeKey] = shared - startOf(follower);
      }
      return { anchor, follower, changed: true };
    }

    // The anchor is the one resized: move the follower's touching edge.
    const followerFarEdge = followerFar(follower);
    let size;
    if (side === 'right' || side === 'bottom') {
      size = followerFarEdge - shared;
      if (size < minFollower) { size = minFollower; shared = followerFarEdge - minFollower; }
      follower[key] = shared;
      follower[sizeKey] = size;
    } else {
      size = shared - startOf(follower);
      if (size < minFollower) { size = minFollower; shared = startOf(follower) + minFollower; }
      follower[sizeKey] = size;
    }
    // Keep the anchor's own outer edge fixed when a follower minimum stopped the
    // splitter: pull the anchor's touching edge back to the clamped position.
    const anchorFarEdge = anchorFar(anchor);
    if (side === 'right' || side === 'bottom') {
      anchor[sizeKey] = Math.max(minAnchor, shared - anchorFarEdge);
    } else {
      anchor[key] = shared;
      anchor[sizeKey] = Math.max(minAnchor, anchorFarEdge - shared);
    }
    return { anchor, follower, changed: true };
  }

  /**
   * Keep `edge` of a window at the same screen position after a programmatic size
   * change (a board's content fit), so a snapped pair does not open a gap.
   * @returns {{x:number,y:number,width:number,height:number}}
   */
  function keepSharedEdge(prev, next, edge) {
    const out = { ...next };
    if (edge === 'right') out.x = prev.x + prev.width - next.width;
    else if (edge === 'bottom') out.y = prev.y + prev.height - next.height;
    else if (edge === 'left') out.x = prev.x;
    else if (edge === 'top') out.y = prev.y;
    return out;
  }

  /** Move every follower in a group flush to its (newly moved) anchor, preserving sizes. */
  function relayoutFollowers(anchor, followers) {
    const out = [];
    for (const f of Array.isArray(followers) ? followers : []) {
      if (!f || !f.rect || !f.side) continue;
      out.push({ ...f, rect: snapFlush(anchor, f.rect, f.side) });
    }
    return out;
  }

  /** Every module's rect for a whole palette (used by the --shot dump and the
   *  drop resolution). */
  function paletteRects(palette, measured, opts) {
    const o = optsOf(opts);
    const box = boardBox(palette, o);
    const boardHeight = Math.max(0, box.height - o.pad * 2);
    const widths = columnWidths(palette && palette.columns, box.width, o);
    return widths.map((w, i) => ({
      columnId: w.columnId,
      width: w.width,
      modules: moduleRects(palette.columns[i], boardHeight, measured, o),
    }));
  }

  return {
    DEFAULTS,
    boardBox,
    columnWidths,
    moduleRects,
    contentSize,
    isContentFit,
    minSize,
    grownSize,
    paletteRects,
    naturalHeight,
    share,
    snapFlush,
    reflowSnapResize,
    keepSharedEdge,
    relayoutFollowers,
  };
});

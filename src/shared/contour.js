/*
 * Iso-lines of a scalar field — the lightness guides, derived from the pixels.
 *
 * A guide has to promise one thing: every point on the line has the same lightness
 * as every other point. A solved contour (an axis sweep plus a root find) cannot
 * promise that: it stops where the solve or the gamut test fails, which is exactly
 * the "line is cut off before the edge, at a lightness it never had" report. This
 * module reads the field the raster itself painted (src/shared/raster-plane.js
 * `luma`), so the line is iso-light by construction and ends exactly where the
 * painted shape ends.
 *
 * Marching squares over the grid, then the segments are stitched into polylines so
 * the caller can stroke each one with a single path (picker-overlay.js#guide).
 * NaN cells are "not painted" and break the line there. A coarse `stride` samples
 * the field sparsely; the gaps that leaves are joined afterwards (`gap`), because a
 * broken guide is unusable as a path to drag along.
 *
 * `nearestOnLines` is the other half: the guide is also the *pick*, so the caller
 * can project a pointer onto it (within a screen-pixel ellipse) and select exactly
 * the colour the line was drawn for.
 *
 * Loads as CommonJS in Node and as a global `IroContour` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroContour = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Edge numbering, clockwise from the top edge, with the cell's corners as
  //   c0 top-left, c1 top-right, c2 bottom-right, c3 bottom-left.
  // Each case lists the edge pairs a crossing joins; 5 and 10 are ambiguous and
  // are resolved by the cell's centre value.
  const CASES = [
    [], [[0, 3]], [[0, 1]], [[1, 3]],
    [[1, 2]], null, [[0, 2]], [[2, 3]],
    [[2, 3]], [[0, 2]], null, [[1, 2]],
    [[1, 3]], [[0, 1]], [[0, 3]], [],
  ];
  const AMBIGUOUS_A = [[0, 1], [2, 3]];
  const AMBIGUOUS_B = [[0, 3], [1, 2]];

  /** Grid coordinates covering 0..size-1 at the requested stride, ends included. */
  function axis(size, stride) {
    const out = [];
    for (let i = 0; i < size; i += stride) out.push(i);
    if (!out.length || out[out.length - 1] !== size - 1) out.push(size - 1);
    return out;
  }

  const key = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

  /**
   * Trace `target` through `field` (row-major, NaN = not painted).
   *
   * @param {Float32Array|number[]} field
   * @param {number} width
   * @param {number} height
   * @param {number} target   same units as the field
   * @param {{stride?: number, gap?: number}} [opts]  `stride` samples the field
   *        (1 = every cell); `gap` joins polyline ends closer than that many pixels
   * @returns {Array<Array<[number, number]>>} polylines in pixel coordinates
   */
  function isoLines(field, width, height, target, opts = {}) {
    if (!field || width < 2 || height < 2 || !Number.isFinite(target)) return [];
    const stride = Math.max(1, Math.round(opts.stride || 1));
    const xs = axis(width, stride);
    const ys = axis(height, stride);
    const segs = [];

    for (let gy = 0; gy < ys.length - 1; gy += 1) {
      const y0 = ys[gy];
      const y1 = ys[gy + 1];
      for (let gx = 0; gx < xs.length - 1; gx += 1) {
        const x0 = xs[gx];
        const x1 = xs[gx + 1];
        const v0 = field[y0 * width + x0];
        const v1 = field[y0 * width + x1];
        const v2 = field[y1 * width + x1];
        const v3 = field[y1 * width + x0];
        if (Number.isNaN(v0) || Number.isNaN(v1) || Number.isNaN(v2) || Number.isNaN(v3)) continue;
        const index = (v0 >= target ? 1 : 0) | (v1 >= target ? 2 : 0)
          | (v2 >= target ? 4 : 0) | (v3 >= target ? 8 : 0);
        if (index === 0 || index === 15) continue;
        let pairs = CASES[index];
        if (pairs === null) {
          // Diagonal neighbours: the centre decides which way the two corners meet.
          const centre = (v0 + v1 + v2 + v3) / 4;
          pairs = (index === 5) === (centre >= target) ? AMBIGUOUS_A : AMBIGUOUS_B;
        }
        // Crossings, lazily: only the edges this case uses are interpolated.
        const cross = (edge) => {
          let a; let b; let ax; let ay; let bx; let by;
          if (edge === 0) { a = v0; b = v1; ax = x0; ay = y0; bx = x1; by = y0; }
          else if (edge === 1) { a = v1; b = v2; ax = x1; ay = y0; bx = x1; by = y1; }
          else if (edge === 2) { a = v2; b = v3; ax = x1; ay = y1; bx = x0; by = y1; }
          else { a = v3; b = v0; ax = x0; ay = y1; bx = x0; by = y0; }
          const t = b === a ? 0.5 : (target - a) / (b - a);
          return [ax + (bx - ax) * t, ay + (by - ay) * t];
        };
        for (const [ea, eb] of pairs) segs.push([cross(ea), cross(eb)]);
      }
    }
    // A single unpainted pixel removes every cell it corners, so a speck of
    // out-of-gamut colour leaves a one-cell hole in the line: bridge those, or the
    // guide arrives in pieces and cannot be dragged as one path.
    const gap = Number.isFinite(opts.gap) ? Math.max(0, opts.gap) : stride * 2.5;
    return joinGaps(stitch(segs), gap);
  }

  /** Join segments that share an endpoint into polylines. */
  function stitch(segs) {
    if (!segs.length) return [];
    const incident = new Map();
    const push = (k, i) => {
      const list = incident.get(k);
      if (list) list.push(i); else incident.set(k, [i]);
    };
    segs.forEach((s, i) => {
      push(key(s[0][0], s[0][1]), i);
      push(key(s[1][0], s[1][1]), i);
    });
    const used = new Uint8Array(segs.length);
    const out = [];
    const nextFrom = (pt) => {
      const list = incident.get(key(pt[0], pt[1])) || [];
      for (const i of list) {
        if (used[i]) continue;
        used[i] = 1;
        const s = segs[i];
        return key(s[0][0], s[0][1]) === key(pt[0], pt[1]) ? s[1] : s[0];
      }
      return null;
    };
    for (let start = 0; start < segs.length; start += 1) {
      if (used[start]) continue;
      used[start] = 1;
      const first = segs[start];
      const pts = [first[0], first[1]];
      // Forward from the tail, then backward from the head.
      for (let p = pts[pts.length - 1]; ;) {
        const nxt = nextFrom(p);
        if (!nxt) break;
        pts.push(nxt);
        p = nxt;
      }
      for (let p = pts[0]; ;) {
        const nxt = nextFrom(p);
        if (!nxt) break;
        pts.unshift(nxt);
        p = nxt;
      }
      if (pts.length > 1) out.push(pts);
    }
    return out;
  }

  /**
   * Join polylines whose ends are within `tol`, in place-safe order. A sparse
   * `stride` samples every other cell, so two consecutive crossing cells can miss
   * the shared vertex and the line arrives as two pieces with a sub-cell gap; this
   * puts it back together so the guide drags as one path. Closed loops are left
   * alone.
   */
  function joinGaps(lines, tol) {
    if (!(tol > 0) || lines.length < 2) return lines;
    const lim = tol * tol;
    // A closed loop's ends coincide to floating-point precision; the join tolerance
    // is much larger than that, so "the ends are close" cannot mean "it is a loop".
    const closed = 0.0625; // 0.25 px
    const out = lines.slice();
    const used = new Uint8Array(out.length);
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < out.length && !merged; i += 1) {
        if (used[i]) continue;
        const a = out[i];
        const aHead = a[0];
        const aTail = a[a.length - 1];
        if (dist2(aHead, aTail) <= closed) continue; // already a loop
        for (let j = i + 1; j < out.length && !merged; j += 1) {
          if (used[j]) continue;
          const b = out[j];
          const bHead = b[0];
          const bTail = b[b.length - 1];
          if (dist2(bHead, bTail) <= closed) continue;
          const joins = [
            [aTail, bHead, false, false],
            [aTail, bTail, false, true],
            [aHead, bHead, true, false],
            [aHead, bTail, true, true],
          ];
          for (const [pa, pb, revA, revB] of joins) {
            if (dist2(pa, pb) > lim) continue;
            const left = revA ? a.slice().reverse() : a.slice();
            const right = revB ? b.slice().reverse() : b.slice();
            out[i] = left.concat(right);
            used[j] = 1;
            out[j] = [];
            merged = true;
            break;
          }
        }
      }
    }
    return out.filter((p) => p.length > 1);
  }

  /** Drop points closer than `step` to the previous kept one (keeps both ends). */
  function decimate(pts, step = 1) {
    if (!pts || pts.length < 3 || !(step > 0)) return pts || [];
    const lim = step * step;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i += 1) {
      if (dist2(out[out.length - 1], pts[i]) >= lim) out.push(pts[i]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /**
   * Nearest point on a set of normalized polylines, inside an ellipse of `ru`/`rv`
   * around (u, v). The slice panels are not square, so the threshold is per axis:
   * `ru = px / width`, `rv = px / height` keeps it a circle on screen.
   * @returns {{u:number, v:number}|null}
   */
  function nearestOnLines(lines, u, v, ru, rv) {
    if (!lines || !lines.length || !(ru > 0) || !(rv > 0)) return null;
    let best = null;
    let bestD = 1;
    for (const pts of lines) {
      if (!pts || pts.length < 1) continue;
      if (pts.length === 1) {
        const d = ((u - pts[0][0]) / ru) ** 2 + ((v - pts[0][1]) / rv) ** 2;
        if (d <= bestD) { bestD = d; best = [pts[0][0], pts[0][1]]; }
        continue;
      }
      for (let i = 0; i + 1 < pts.length; i += 1) {
        const ax = pts[i][0];
        const ay = pts[i][1];
        const dx = pts[i + 1][0] - ax;
        const dy = pts[i + 1][1] - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? ((u - ax) * dx + (v - ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + dx * t;
        const py = ay + dy * t;
        const d = ((u - px) / ru) ** 2 + ((v - py) / rv) ** 2;
        if (d <= bestD) { bestD = d; best = [px, py]; }
      }
    }
    return best ? { u: best[0], v: best[1] } : null;
  }

  return { isoLines, decimate, nearestOnLines };
});

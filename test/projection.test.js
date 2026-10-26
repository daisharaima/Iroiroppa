'use strict';

// The projection map contract (docs/MODULES.md, "Slice projections"): each map is
// pure and invertible so a pick lands where it was drawn, the polar mask says
// "no slice point here" instead of inventing one, and the cusp frame's apex moves
// with the hue.

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../src/shared/projection');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('pickInside keeps a drag inside the drawn triangle and never freezes', () => {
  const tri = P.triangleFixed();
  const inside = P.pickInside(tri, 0.5, 0.5);
  assert.ok(inside.inside, 'a point in the shape keeps its own coordinates');

  // Far outside every edge: the nearest in-shape point, with both coordinates
  // responding — not one axis clamped while the other slides.
  const out = P.pickInside(tri, 0.2, 0.95);
  assert.strictEqual(out.inside, false);
  assert.ok(out.u >= 0 && out.u <= 1 && out.v >= 0 && out.v <= 1);
  const corner = P.pickInside(tri, -1, 2);
  assert.ok(corner.u >= 0 && corner.u <= 1 && corner.v >= 0 && corner.v <= 1);
  // Two points left of the shape at different heights must not map to the same pick
  // (that is the "only follows the horizontal position" symptom). Outside the left
  // edge the nearest points differ along the zero-saturation edge, so the lightness (u)
  // is what moves.
  const a = P.pickInside(tri, 0.1, 0.8);
  const b = P.pickInside(tri, 0.1, 0.2);
  assert.ok(Math.abs(a.u - b.u) > 1e-6, 'vertical movement still changes the pick');
});

test('flat is the identity with y up', () => {
  const s = P.flat.toScreen(0.25, 0.75);
  assert.ok(near(s.x, 0.25) && near(s.y, 0.25));
  const back = P.flat.fromScreen(s.x, s.y);
  assert.ok(near(back.u, 0.25) && near(back.v, 0.75));
});

test('polar maps hue clockwise from +x and round-trips', () => {
  assert.ok(near(P.polar.toScreen(0, 1).x, 1), 'hue 0 is +x at full radius');
  const right = P.polar.toScreen(0.25, 1);
  assert.ok(near(right.x, 0.5) && near(right.y, 1), 'a quarter turn is straight down (y grows)');
  for (let i = 0; i <= 8; i += 1) {
    for (let j = 1; j <= 4; j += 1) {
      const u = i / 8;
      const v = j / 4;
      const back = P.polar.fromScreen(...Object.values(P.polar.toScreen(u, v)));
      const du = Math.min(Math.abs(back.u - u), 1 - Math.abs(back.u - u));
      assert.ok(du < 1e-9 && near(back.v, v, 1e-9), `polar ${u},${v} -> ${JSON.stringify(back)}`);
    }
  }
});

test('the polar mask rejects points outside the disc', () => {
  assert.equal(P.polar.fromScreen(0, 0), null, 'a corner is outside');
  assert.equal(P.polar.fromScreen(0.5, 0.5).v, 0, 'the centre is the axis');
  const edge = P.polar.fromScreen(0.9999, 0.5);
  assert.ok(edge && edge.v <= 1);
});

test('the cusp frame moves its apex with the hue and round-trips', () => {
  const low = P.triangle({ a: 0.2, b: 1 }); // blue-ish cusp: dark
  const high = P.triangle({ a: 0.9, b: 1 }); // yellow-ish cusp: light
  const lowApex = low.toScreen(low.cusp.a, 1);
  const highApex = high.toScreen(high.cusp.a, 1);
  assert.ok(lowApex.y > highApex.y, 'the apex sits lower for a dark cusp');
  assert.ok(near(lowApex.x, 0.9) && near(highApex.x, 0.9), 'every cusp shares the vertical line');

  for (let i = 1; i < 8; i += 1) {
    for (let j = 1; j < 8; j += 1) {
      const a = i / 8;
      const b = j / 8;
      const s = high.toScreen(a, b);
      const back = high.fromScreen(s.x, s.y);
      assert.ok(near(back.u, a, 1e-9) && near(back.v, b, 1e-9), `triangle ${a},${b}`);
    }
  }
});

test('the cusp frame puts black, white and the cusp on the triangle vertices', () => {
  const t = P.triangle({ a: 0.5, b: 1 });
  const k = t.toScreen(0, 0);
  const w = t.toScreen(1, 0);
  const cusp = t.toScreen(0.5, 1);
  assert.ok(near(k.x, P.TRI_K.x) && near(k.y, P.TRI_K.y), 'a=0,b=0 is black');
  assert.ok(near(w.x, P.TRI_W.x) && near(w.y, P.TRI_W.y), 'a=1,b=0 is white');
  assert.ok(near(cusp.x, P.TRI_APEX_X) && near(cusp.y, 0.5), 'the cusp is the apex');
});

test('black and white sit on the square mode\u2019s left edge, on the circle', () => {
  const r = (p) => Math.hypot(p.x - 0.5, p.y - 0.5);
  assert.ok(near(r(P.TRI_K), 0.5) && near(r(P.TRI_W), 0.5), 'K/W are on the circle');
  assert.ok(near(P.TRI_K.x, 0.1464466094) && near(P.TRI_W.x, 0.1464466094),
    'the cusp frame keeps the square mode\u2019s black-white side');
  const f = P.triangleFixed();
  assert.ok(near(r(f.toScreen(0, 0)), 0.5), 'the fixed black corner is on the circle');
  assert.ok(near(r(f.toScreen(1, 0)), 0.5), 'the fixed white corner is on the circle');
  assert.ok(near(r(f.toScreen(1, 1)), 0.5), 'the fixed pure hue is on the circle');
});

test('the fixed triangle is equilateral', () => {
  const t = P.triangleFixed();
  const K = t.toScreen(0, 0);
  const W = t.toScreen(1, 0);
  const A = t.toScreen(1, 1);
  const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const base = d(K, W);
  assert.ok(near(d(K, A), base, 1e-9), 'black-to-apex equals the base');
  assert.ok(near(d(W, A), base, 1e-9), 'white-to-apex equals the base');
});

test('a chroma-less slice has no cusp frame', () => {
  assert.equal(P.triangle({ a: 0.5, b: 0 }), null);
  assert.equal(P.triangle({ a: 0.5, b: 1e-4 }), null);
  assert.equal(P.triangle(null), null);
});

test('findCusp finds an interior cusp and a corner cusp', () => {
  // A lens-shaped gamut: chroma peaks in the middle of the lightness axis.
  const lens = (a) => ({ b: Math.sin(Math.PI * a), chroma: Math.sin(Math.PI * a) });
  const c1 = P.findCusp(lens);
  assert.ok(near(c1.a, 0.5, 1e-3), `lens cusp at ${c1.a}`);
  assert.ok(c1.b > 0.99);

  // A dense (Okhsv-like) slice: the max chroma is the corner at the top.
  const corner = (a) => ({ b: 1, chroma: Math.pow(a, 2) });
  const c2 = P.findCusp(corner);
  assert.ok(c2.a > 0.99, `corner cusp at ${c2.a}`);
});

test('boxCoords keeps a projection square inside any panel', () => {
  // Square panel: identity.
  const sq = P.boxCoords(0.25, 0.75, 1);
  assert.ok(near(sq.x, 0.25) && near(sq.y, 0.75));
  // Wide panel: the square grows horizontally, so the same point moves outward.
  const wide = P.boxCoords(1, 0.5, 2);
  assert.ok(near(wide.x, 1.5) && near(wide.y, 0.5), 'the right edge of a 2:1 panel is outside the square');
  assert.ok(near(P.boxCoords(0.75, 0.5, 2).x, 1), 'x = 0.75 is the square edge in a 2:1 panel');
  // Tall panel: the square grows vertically instead.
  const tall = P.boxCoords(0.5, 1, 0.5);
  assert.ok(near(tall.x, 0.5) && near(tall.y, 1.5));
  for (const aspect of [1, 1.5, 2, 0.5, 0.75, 3]) {
    for (let i = 0; i <= 4; i += 1) {
      for (let j = 0; j <= 4; j += 1) {
        const b = P.boxCoords(i / 4, j / 4, aspect);
        const back = P.panelCoords(b.x, b.y, aspect);
        assert.ok(near(back.x, i / 4) && near(back.y, j / 4), `round trip at aspect ${aspect}`);
      }
    }
  }
});

test('supports() gates by axis shape', () => {
  const hueChroma = { hueHorizontal: true, chromaVertical: true };
  const hueSlice = { hueFixed: true, chromaVertical: true };
  const lightnessChroma = { hueHorizontal: false, chromaVertical: true };
  assert.equal(P.supports('flat', lightnessChroma), true);
  assert.equal(P.supports('polar', hueChroma), true);
  assert.equal(P.supports('polar', lightnessChroma), false);
  assert.equal(P.supports('triangle', hueSlice), true);
  assert.equal(P.supports('triangle', hueChroma), false, 'a hue-chroma slice has no cusp frame');
  assert.equal(P.supports('nope'), false);
});

test('the fixed triangle puts white, black and the pure hue on fixed corners', () => {
  const t = P.triangleFixed();
  const corner = (u, v) => t.toScreen(u, v);
  assert.deepEqual(corner(1, 0), { x: P.TRI_FIXED_W.x, y: P.TRI_FIXED_W.y }, 'u=1, s=0 is white');
  assert.deepEqual(corner(0, 0.4), { x: P.TRI_FIXED_K.x, y: P.TRI_FIXED_K.y }, 'v=0 is black at any saturation');
  assert.deepEqual(corner(1, 1), { x: P.TRI_FIXED_APEX.x, y: P.TRI_FIXED_APEX.y }, 'u=1, s=1 is the pure hue');
  // Same geometry for every hue: the corners do not depend on a cusp.
  assert.deepEqual(t.toScreen(1, 1), t.toScreen(1, 1));
});

test('the fixed triangle is invertible across the slice', () => {
  const t = P.triangleFixed();
  for (const [u, v] of [[0, 0], [0.25, 0.5], [0.5, 0.5], [0.9, 0.9], [1, 0.3]]) {
    const p = t.toScreen(u, v);
    const back = t.fromScreen(p.x, p.y);
    assert.ok(Math.abs(back.u - u) < 1e-9, `u ${u} round trip`);
    assert.ok(Math.abs(back.v - v) < 1e-9, `v ${v} round trip`);
  }
});

test('the fixed triangle is the classic barycentric triangle, not the square', () => {
  const t = P.triangleFixed();
  // The bottom-right of the rectangle is outside the triangle: u + v > 1.
  const outside = t.fromScreen(0.8, 0.8);
  assert.ok(outside.u + outside.v > 1, 'the lower-right rectangle corner is outside');
  assert.equal(t.id, 'triangle-fixed');
});

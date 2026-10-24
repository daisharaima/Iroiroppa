'use strict';

// Selector module: the colour wheel. A hue ring around the model's hue slice —
// the two axes that are not hue, so OKLCH shows L x C, OKHSV S x V and OKHSL
// S x L. The ring turns only the hue (chroma lives inside), and the inner shape
// can be drawn flat or in the cusp frame (projection.js), the same maths the
// slices use.
//
// The ring colours are the most saturated in-gamut colour at that hue, so a
// low-chroma current colour does not turn a vivid ring grey; the inner shape is
// where the honest value sits.

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};
  const Models = window.IroColorModels;
  const Pj = window.IroProjection || null;
  const WHEEL_MODELS = ['oklch', 'okhsv', 'okhsl'];
  // Models whose slice square is itself the gamut, so a triangle is exact and the
  // user may switch between the square and the triangle. OKLCH is always flat.
  const SHAPED_MODELS = ['okhsv', 'okhsl'];

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp255 = (x) => clamp(Math.round(x), 0, 255);

  /** The model's hue axis index (0 for OKHSV/OKHSL, 2 for OKLCH). */
  const hueIndexOf = (model) => model.hueIndex;
  /** The chroma/saturation axis is always the second one; the other axis is lightness. */
  const lightAxis = (model) => (model.axes[0].key === 'h' ? 2 : 0);

  const settingsUI = (api, root) => {
    const modelRow = document.createElement('label');
    modelRow.className = 'pop-row';
    const modelName = document.createElement('span');
    modelName.textContent = window.Iro.t('module.settings.model');
    const sel = document.createElement('select');
    sel.className = 'pop-select';
    for (const m of Models.list()) {
      if (!WHEEL_MODELS.includes(m.id)) continue;
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      sel.append(opt);
    }
    sel.value = WHEEL_MODELS.includes(api.get().model) ? api.get().model : 'oklch';
    sel.addEventListener('change', () => { api.patch({ model: sel.value }); syncShapeRow(); });
    modelRow.append(modelName, sel);
    root.append(modelRow);

    const shapeRow = document.createElement('div');
    shapeRow.className = 'pop-row';
    const shapeName = document.createElement('span');
    shapeName.textContent = window.Iro.t('module.wheel.shape');
    const seg = document.createElement('div');
    seg.className = 'pop-seg';
    const shapeBtns = [];
    const shapeNow = () => (api.get().shape === 'square' ? 'square' : 'triangle');
    for (const [value, key] of [['triangle', 'module.wheel.shape.triangle'], ['square', 'module.wheel.shape.square']]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = window.Iro.t(key);
      btn.dataset.shape = value;
      btn.setAttribute('aria-pressed', String(value === shapeNow()));
      btn.addEventListener('click', () => {
        api.patch({ shape: value });
        for (const other of shapeBtns) other.setAttribute('aria-pressed', String(other === btn));
      });
      shapeBtns.push(btn);
      seg.append(btn);
    }
    shapeRow.append(shapeName, seg);
    root.append(shapeRow);

    const ringRow = document.createElement('label');
    ringRow.className = 'pop-row pop-row-range';
    const ringName = document.createElement('span');
    ringName.textContent = window.Iro.t('module.wheel.ringWidth');
    const rng = document.createElement('input');
    rng.type = 'range';
    rng.className = 'pop-range';
    rng.min = '0.06';
    rng.max = '0.22';
    rng.step = '0.01';
    const rv = Number(api.get().ringWidth);
    rng.value = String(Number.isFinite(rv) ? rv : 0.12);
    const out = document.createElement('span');
    out.className = 'pop-range-value';
    out.textContent = rng.value;
    rng.addEventListener('input', () => { api.patch({ ringWidth: Number(rng.value) }); out.textContent = rng.value; });
    ringRow.append(ringName, rng, out);
    root.append(ringRow);

    const numbers = document.createElement('label');
    numbers.className = 'pop-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = api.get().hideNumbers === true;
    const label = document.createElement('span');
    label.textContent = window.Iro.t('module.settings.hideValues');
    numbers.append(box, label);
    box.addEventListener('change', () => api.patch({ hideNumbers: box.checked }));
    root.append(numbers);

    // The inner shape only exists where the slice square is itself the gamut
    // (Okhsv/Okhsl); OKLCH always shows its flat L×C slice.
    const syncShapeRow = () => { shapeRow.classList.toggle('hidden', !SHAPED_MODELS.includes(sel.value)); };
    syncShapeRow();
  };

  reg.modules['color-wheel'] = {
    id: 'color-wheel',
    name: 'Color Wheel',
    version: 1,
    defaults: { model: 'oklch', shape: 'triangle', ringWidth: 0.12, hideNumbers: false },
    settingsUI,
    minSize() { return { width: 128, height: 128 }; },

    create(ctx) {
      const Color = window.Color;
      const store = ctx.color;
      const WHEEL = WHEEL_MODELS.filter((id) => Models.has(id));

      let modelId = WHEEL.includes(ctx.settings.get().model) ? ctx.settings.get().model : 'oklch';
      let shape = ctx.settings.get().shape === 'square' ? 'square' : 'triangle';
      let ringWidth = clamp(Number(ctx.settings.get().ringWidth) || 0.12, 0.06, 0.22);
      let hideNumbers = ctx.settings.get().hideNumbers === true;

      const wrap = document.createElement('div');
      wrap.className = 'wheel-body';
      const canvas = document.createElement('canvas');
      canvas.className = 'wheel-plot';
      wrap.append(canvas);
      ctx.el.append(wrap);

      const footer = document.createElement('div');
      footer.className = 'slice-footer';
      const outLabels = [];
      const outNums = [];
      const addValue = (id) => {
        const item = document.createElement('span');
        item.className = 'slice-value';
        const key = document.createElement('b');
        const num = document.createElement('span');
        num.id = id;
        item.append(key, num);
        footer.append(item);
        outLabels.push(key);
        outNums.push(num);
      };
      addValue('wheel-out-L');
      addValue('wheel-out-C');
      addValue('wheel-out-H');
      ctx.el.append(footer);

      const modelNow = () => Models.get(modelId) || Models.get('oklch');

      const sizeCanvas = (cap = 2) => {
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), cap);
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        return { w, h };
      };

      const geometry = (w, h) => {
        const size = Math.min(w, h);
        const outer = Math.max(0, size / 2 - 2);
        const ringW = Math.min(Math.max(size * ringWidth, 10), Math.max(1, size * 0.25));
        return { cx: w / 2, cy: h / 2, outer, inner: Math.max(0, outer - ringW), ringW };
      };

      // --- ring --------------------------------------------------------------
      const ringCache = new Map();
      const ringPlot = (w, h, model, geo, third) => {
        const key = `ring:${store.plotKeyTag()}:${model.id}:${third.toFixed(3)}:${w}x${h}`;
        const hit = ringCache.get(key);
        if (hit && hit.width === w && hit.height === h) return hit;
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        // A freshly mounted module has no box yet (w or h = 1): nothing to draw.
        if (geo.ringW <= 0 || geo.outer <= 0) return off;
        const hIdx = hueIndexOf(model);
        const lIdx = lightAxis(model);
        const axes = [0, 0, 0];
        axes[lIdx] = third;
        const radius = (geo.inner + geo.outer) / 2;
        const stepDeg = 1;
        for (let deg = 0; deg < 360; deg += stepDeg) {
          // Hue sweeps clockwise from +x, the same convention as projection#polar.
          axes[hIdx] = deg;
          // Maximise the saturation axis at this hue: the cusp direction for
          // OKLCH, s = 1 for the dense Okhsv/Okhsl.
          const b = innerSaturation(model, axes);
          axes[1] = b;
          const lab = model.toLab(axes);
          const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
          const rgb = Color.fitToSrgb(lch.L, lch.C, lch.H);
          // A degree-wide wedge with a half-degree overlap so neighbours never
          // leave a seam; the stroke is wider than the wedge, so the ring is solid.
          const a0 = (deg - 0.4) * Math.PI / 180;
          const a1 = (deg + 1.4) * Math.PI / 180;
          c2d.beginPath();
          c2d.arc(geo.cx, geo.cy, radius, a0, a1);
          c2d.strokeStyle = `rgb(${clamp255(rgb.r * 255)},${clamp255(rgb.g * 255)},${clamp255(rgb.b * 255)})`;
          c2d.lineWidth = geo.ringW;
          c2d.stroke();
        }
        for (const cache of [ringCache]) {
          if (cache.size > 8) cache.clear();
        }
        ringCache.set(key, off);
        return off;
      };

      /** The saturation of the most saturated colour at this hue (axis 1). */
      const innerSaturation = (model, axes) => {
        if (model.id !== 'oklch') return 1; // dense: s = 1 is in sRGB by construction
        const L = axes[0], H = axes[2];
        return clamp(store.maxChroma(L, H), 0, model.axes[1].max);
      };

      // --- inner shape -------------------------------------------------------
      const innerCache = new Map();
      let lastInner = null;
      let innerBuilt = 0;
      const cuspFor = (model, hue, third) => {
        const sample = (a) => {
          const axes = [0, 0, 0];
          const lIdx = lightAxis(model);
          const hIdx = hueIndexOf(model);
          axes[hIdx] = hue;
          if (model.id === 'oklch') {
            const L = a; // OKLCH's lightness axis is L itself (0..1)
            axes[0] = L;
            axes[2] = hue;
            const ivs = store.chromaIntervals(L, hue);
            const C = ivs.length ? ivs[ivs.length - 1][1] : 0;
            return { b: C / model.axes[1].max, chroma: C };
          }
          axes[lIdx] = model.axes[lIdx].min + a * (model.axes[lIdx].max - model.axes[lIdx].min);
          axes[1] = model.axes[1].max;
          const lab = model.toLab(axes);
          return { b: 1, chroma: Math.hypot(lab.a, lab.b) };
        };
        return Pj ? Pj.findCusp(sample) : null;
      };

      const innerProj = (model, hue) => {
        if (!Pj) return null;
        // OKLCH always draws its L×C slice flat, whatever the shape setting says:
        // the lens has to be seen whole, so there is no triangle for it.
        if (!SHAPED_MODELS.includes(model.id) || shape !== 'triangle') return Pj.flat;
        // Okhsv's square *is* the gamut, so its triangle has fixed corners; Okhsl
        // gets the cusp frame, whose apex follows the hue.
        if (model.id === 'okhsv') return Pj.triangleFixed();
        const cusp = cuspFor(model, hue);
        return (cusp && Pj.triangle(cusp)) || Pj.flat;
      };

      const buildInner = (w, h, model, hue, proj, box) => {
        const key = `inner:${store.plotKeyTag()}:${model.id}:${shape}:${hue.toFixed(1)}:${w}x${h}:${proj && proj.cusp ? `${proj.cusp.a.toFixed(3)},${proj.cusp.b.toFixed(3)}` : proj ? proj.id : 'f'}`;
        const hit = innerCache.get(key);
        if (hit && hit.width === w && hit.height === h) return hit;
        // While dragging, rebuild at most every ~90 ms and reuse the last image:
        // the hue slice follows the hue, so a ring drag would otherwise re-raster
        // the whole inner shape on every pointer move.
        const now = performance.now();
        if (store.dragging && lastInner && lastInner.width === w && lastInner.height === h && now - innerBuilt < 90) {
          return lastInner;
        }
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        const img = c2d.createImageData(w, h);
        const data = img.data;
        const lIdx = lightAxis(model);
        const hr = model.axes[lIdx];
        const vr = model.axes[1];
        const axes = [0, 0, 0];
        axes[hueIndexOf(model)] = hue;
        const bw = box.w, bh = box.h, bx = box.x, by = box.y;
        for (let y = 0; y < bh; y += 1) {
          const yN = y / (bh - 1);
          for (let x = 0; x < bw; x += 1) {
            const xN = x / (bw - 1);
            let un = xN;
            let vn = 1 - yN;
            if (proj && proj.id !== 'flat') {
              const m = proj.fromScreen(xN, yN);
              if (!m || m.u < 0 || m.u > 1 || m.v < 0 || m.v > 1) continue;
              un = m.u;
              vn = m.v;
            }
            axes[lIdx] = hr.min + un * (hr.max - hr.min);
            axes[1] = vr.min + vn * (vr.max - vr.min);
            const lab = model.toLab(axes);
            const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
            const inside = model.dense || store.inGamut(lch.L, lch.C, lch.H);
            const px = (Math.round(by) + y) * w + (Math.round(bx) + x);
            const i = px * 4;
            if (i < 0 || i + 3 >= data.length) continue;
            if (inside) {
              const rgb = Color.fitToSrgb(lch.L, lch.C, lch.H);
              data[i] = clamp255(rgb.r * 255);
              data[i + 1] = clamp255(rgb.g * 255);
              data[i + 2] = clamp255(rgb.b * 255);
              data[i + 3] = 255;
            }
            // Outside the gamut stays transparent, like the OKLCH slices: the
            // inner shape is a silhouette, not a hatched chart.
          }
        }
        c2d.putImageData(img, 0, 0);
        if (innerCache.size > 8) innerCache.clear();
        innerCache.set(key, off);
        lastInner = off;
        innerBuilt = now;
        return off;
      };

      // --- layout helpers -----------------------------------------------------
      /** The inner control's box inside the panel, in device pixels. */
      const innerBox = (geo, proj) => {
        if (proj && proj.id.startsWith('triangle')) {
          return { x: geo.cx - geo.inner, y: geo.cy - geo.inner, w: geo.inner * 2, h: geo.inner * 2 };
        }
        const half = geo.inner / Math.SQRT2;
        return { x: geo.cx - half, y: geo.cy - half, w: half * 2, h: half * 2 };
      };

      /** Slice coordinates of the current colour. */
      const currentAxes = () => Models.axesFor(modelNow(), store);

      const projectPoint = (proj, box, u, v) => {
        const sp = proj ? proj.toScreen(u, v) : { x: u, y: 1 - v };
        return { x: box.x + sp.x * (box.w - 1), y: box.y + sp.y * (box.h - 1) };
      };

      // --- pointer ------------------------------------------------------------
      let active = null; // 'ring' | 'inner'
      const pointAt = (ev) => {
        const rect = canvas.getBoundingClientRect();
        const dpr = canvas.width / rect.width;
        const px = (ev.clientX - rect.left) * dpr;
        const py = (ev.clientY - rect.top) * dpr;
        return { px, py };
      };

      const applyAt = (ev) => {
        const { px, py } = pointAt(ev);
        const { w, h } = { w: canvas.width, h: canvas.height };
        const geo = geometry(w, h);
        const model = modelNow();
        const hIdx = hueIndexOf(model);
        const axes = currentAxes();
        if (active === 'ring') {
          let deg = (Math.atan2(py - geo.cy, px - geo.cx) * 180) / Math.PI;
          if (deg < 0) deg += 360;
          axes[hIdx] = deg;
          // Keep the current chroma/saturation: the ring only turns the hue.
          store.setLab(model.toLab(axes), { notify: 'live' });
          return;
        }
        const proj = innerProj(model, axes[hIdx]);
        const box = innerBox(geo, proj);
        const xN = clamp((px - box.x) / (box.w - 1), 0, 1);
        const yN = clamp((py - box.y) / (box.h - 1), 0, 1);
        let un = xN;
        let vn = 1 - yN;
        if (proj && proj.id !== 'flat') {
          const m = proj.fromScreen(xN, yN);
          if (!m) return;
          un = clamp(m.u, 0, 1);
          vn = clamp(m.v, 0, 1);
        }
        const lIdx = lightAxis(model);
        axes[lIdx] = model.axes[lIdx].min + un * (model.axes[lIdx].max - model.axes[lIdx].min);
        axes[1] = model.axes[1].min + vn * (model.axes[1].max - model.axes[1].min);
        store.setLab(model.toLab(axes), { notify: 'live', snap: true });
      };

      const attach = () => {
        canvas.addEventListener('pointerdown', (ev) => {
          const { px, py } = pointAt(ev);
          const geo = geometry(canvas.width, canvas.height);
          const d = Math.hypot(px - geo.cx, py - geo.cy);
          const ringMid = (geo.inner + geo.outer) / 2;
          if (Math.abs(d - ringMid) <= geo.ringW / 2 + 2) active = 'ring';
          else if (d <= geo.inner) active = 'inner';
          else return;
          store.dragging = true;
          canvas.setPointerCapture(ev.pointerId);
          applyAt(ev);
          ev.preventDefault();
        });
        canvas.addEventListener('pointermove', (ev) => { if (active) applyAt(ev); });
        const end = () => {
          if (!active) return;
          active = null;
          store.dragging = false;
          store.setLCH(store.lch(), { notify: 'commit' });
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
      };

      // --- render -------------------------------------------------------------
      let rafId = 0;
      const schedule = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => { rafId = 0; render(); });
      };

      const render = () => {
        const { w, h } = sizeCanvas(2);
        // A module that is still unmeasured draws nothing (the box arrives via
        // onResize); arc() with a negative radius throws and would abort the board.
        if (w < 12 || h < 12) return;
        const geo = geometry(w, h);
        const model = modelNow();
        const axes = currentAxes();
        const hIdx = hueIndexOf(model);
        const lIdx = lightAxis(model);
        const hue = axes[hIdx];
        const third = axes[lIdx];
        const c2d = canvas.getContext('2d');
        c2d.setTransform(1, 0, 0, 1, 0, 0);
        c2d.clearRect(0, 0, w, h);
        const ring = ringPlot(w, h, model, geo, third);
        c2d.drawImage(ring, 0, 0);
        const proj = innerProj(model, hue);
        const box = innerBox(geo, proj);
        c2d.drawImage(buildInner(w, h, model, hue, proj, box), 0, 0);

        // Ring thumb: the current hue, on the ring's mid radius.
        const a = (hue * Math.PI) / 180;
        const cxr = geo.cx + ((geo.inner + geo.outer) / 2) * Math.cos(a);
        const cyr = geo.cy + ((geo.inner + geo.outer) / 2) * Math.sin(a);
        c2d.beginPath();
        c2d.arc(cxr, cyr, clamp(geo.ringW * 0.32, 3, 7), 0, Math.PI * 2);
        c2d.lineWidth = 1.5;
        c2d.strokeStyle = 'rgba(0,0,0,0.75)';
        c2d.stroke();
        c2d.strokeStyle = 'rgba(255,255,255,0.9)';
        c2d.lineWidth = 1;
        c2d.stroke();

        if (store.crosshair) {
          const lr = model.axes[lIdx];
          const vr = model.axes[1];
          const su = (axes[lIdx] - lr.min) / (lr.max - lr.min);
          const sv = (axes[1] - vr.min) / (vr.max - vr.min);
          const p = projectPoint(proj, box, su, sv);
          c2d.beginPath();
          c2d.arc(p.x, p.y, 4, 0, Math.PI * 2);
          c2d.lineWidth = 1.5;
          c2d.strokeStyle = 'rgba(0,0,0,0.75)';
          c2d.stroke();
          c2d.strokeStyle = 'rgba(255,255,255,0.9)';
          c2d.lineWidth = 1;
          c2d.stroke();
        }

        const labels = model.axes;
        for (let i = 0; i < 3; i += 1) {
          outLabels[i].textContent = labels[i].key.toUpperCase();
          outNums[i].textContent = Models.formatAxis(labels[i], axes[i]);
        }
      };

      const unsubscribe = store.subscribe(schedule);
      attach();
      render();

      return {
        onResize() { schedule(); },
        onSettings(settings) {
          // A partial payload must not reset a value it does not carry: the def's
          // defaults are applied at mount, not on every settings push.
          if (settings.model !== undefined) {
            const nextModel = WHEEL.includes(settings.model) ? settings.model : 'oklch';
            if (nextModel !== modelId) {
              modelId = nextModel;
              ringCache.clear();
              innerCache.clear();
            }
          }
          if (settings.shape !== undefined) {
            const nextShape = settings.shape === 'square' ? 'square' : 'triangle';
            if (nextShape !== shape) {
              shape = nextShape;
              innerCache.clear();
            }
          }
          if (settings.ringWidth !== undefined) {
            ringWidth = clamp(Number(settings.ringWidth) || 0.12, 0.06, 0.22);
          }
          if (settings.hideNumbers !== undefined) hideNumbers = settings.hideNumbers === true;
          footer.classList.toggle('hidden', hideNumbers);
          schedule();
        },
        settings(root) { settingsUI(ctx.settings, root); },
        destroy() {
          unsubscribe();
          if (rafId) cancelAnimationFrame(rafId);
        },
      };
    },
  };
})();

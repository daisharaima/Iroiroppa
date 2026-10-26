'use strict';

// Selector module: the colour wheel. A hue ring around the model's hue slice —
// the two axes that are not hue, so OKLCH shows L x C and OKHSV/OKHSL show
// light x saturation. The ring turns only the hue (chroma lives inside), and the
// inner shape can be drawn flat or in the cusp frame (projection.js).
//
// The ring has two bands (you asked for this): the OUTER band is a fixed pure-hue
// reference that never changes with the selected colour; the INNER band is the
// model's most saturated colour at the current lightness/value, so it follows the
// selection. Both bands turn the hue.
//
// The inner frame is inscribed in the ring's hole: black and white sit exactly on
// the inner edge. Okhsv's triangle is fixed (all three corners on the circle);
// Okhsl's cusp frame keeps the cusp on the vertical line x = 0.9 (K/W on the
// circle, the cusp touches it only near mid-lightness).

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};
  const Models = window.IroColorModels;
  const G = window.IroSliceGeometry;
  const Overlay = window.IroPickerOverlay;
  const Cadence = window.IroRenderCadence;
  const Pj = window.IroProjection || null;
  const SV = window.IroSliceView || null;
  const WHEEL_MODELS = ['oklch', 'okhsv', 'okhsl', 'cielch', 'helmgenlch'];
  // Models whose slice square is itself the gamut, so a triangle is exact and the
  // user may switch between the square and the triangle. OKLCH is always flat.
  const SHAPED_MODELS = ['okhsv', 'okhsl'];
  const RING_SPLIT = 0.5; // outer reference band / inner contextual band

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp01 = (x) => clamp(x, 0, 1);
  const clamp255 = (x) => clamp(Math.round(x), 0, 255);

  /** The model's hue axis index (0 for OKHSV/OKHSL, 2 for OKLCH). */
  const hueIndexOf = (model) => model.hueIndex;
  const Raster = typeof window !== 'undefined' ? window.IroRasterPlane : null;
  /** The model's lightness/value axis (0 for OKLCH, 2 for OKHSV/OKHSL). */
  const lightAxis = (model) => Models.lightAxis(model);

  const settingsUI = (api, root, store) => {
    const modelRow = document.createElement('label');
    modelRow.className = 'pop-row';
    const modelName = document.createElement('span');
    modelName.textContent = window.Iro.t('module.settings.model');
    const available = Models.listForFamily(store.viewFamily || 'all')
      .filter((m) => WHEEL_MODELS.includes(m.id));
    modelRow.append(modelName);
    window.IroModelOptions.menu(modelRow, {
      groups: window.IroModelOptions.groups(available),
      value: available.some((m) => m.id === api.get().model)
        ? api.get().model
        : Models.defaultForFamily(store.viewFamily || 'all'),
      onChange: (id) => { api.patch({ model: id }); syncShapeRow(id); },
    });
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

    const hueRow = document.createElement('label');
    hueRow.className = 'pop-row pop-row-range';
    const hueName = document.createElement('span');
    hueName.textContent = window.Iro.t('module.wheel.hueRotate');
    const hueRng = document.createElement('input');
    hueRng.type = 'range';
    hueRng.className = 'pop-range';
    hueRng.min = '0';
    hueRng.max = '360';
    hueRng.step = '1';
    const hv = Number(api.get().hueRotation) || 0;
    hueRng.value = String(((hv % 360) + 360) % 360);
    const hueOut = document.createElement('span');
    hueOut.className = 'pop-range-value';
    hueOut.textContent = `${hueRng.value}\u00b0`;
    hueRng.addEventListener('input', () => {
      api.patch({ hueRotation: Number(hueRng.value) });
      hueOut.textContent = `${hueRng.value}\u00b0`;
    });
    hueRow.append(hueName, hueRng, hueOut);
    root.append(hueRow);

    const viewRow = document.createElement('div');
    viewRow.className = 'pop-row';
    const viewName = document.createElement('span');
    viewName.textContent = window.Iro.t('module.wheel.inner');
    const rot = document.createElement('button');
    rot.type = 'button';
    rot.className = 'icon-btn slice-view-btn';
    rot.textContent = '\u21bb';
    const flipH = document.createElement('button');
    flipH.type = 'button';
    flipH.className = 'icon-btn slice-view-btn';
    flipH.textContent = '\u21c6';
    const flipV = document.createElement('button');
    flipV.type = 'button';
    flipV.className = 'icon-btn slice-view-btn';
    flipV.textContent = '\u21c5';
    const refreshView = () => {
      const angle = ((Number(api.get().innerRotate) || 0) % 360 + 360) % 360;
      rot.title = `${window.Iro.t('module.slices.rotate')} inner ${angle}\u00b0`;
      rot.setAttribute('aria-label', rot.title);
      flipH.title = `${window.Iro.t('module.slices.flipH')} inner`;
      flipH.setAttribute('aria-label', flipH.title);
      flipV.title = `${window.Iro.t('module.slices.flipV')} inner`;
      flipV.setAttribute('aria-label', flipV.title);
      rot.setAttribute('aria-pressed', String(angle !== 0));
      flipH.setAttribute('aria-pressed', String(api.get().innerFlipH === true));
      flipV.setAttribute('aria-pressed', String(api.get().innerFlipV === true));
    };
    rot.addEventListener('click', () => {
      api.patch({ innerRotate: ((Number(api.get().innerRotate) || 0) + 90) % 360 }, { immediate: true });
      refreshView();
    });
    flipH.addEventListener('click', () => {
      api.patch({ innerFlipH: api.get().innerFlipH !== true }, { immediate: true });
      refreshView();
    });
    flipV.addEventListener('click', () => {
      api.patch({ innerFlipV: api.get().innerFlipV !== true }, { immediate: true });
      refreshView();
    });
    refreshView();
    viewRow.append(viewName, rot, flipH, flipV);
    root.append(viewRow);

    const guideRow = document.createElement('label');
    guideRow.className = 'pop-row';
    const guideBox = document.createElement('input');
    guideBox.type = 'checkbox';
    guideBox.checked = api.get().guideLines !== false;
    const guideName = document.createElement('span');
    guideName.textContent = window.Iro.t('module.slices.guide');
    guideRow.append(guideBox, guideName);
    guideBox.addEventListener('change', () => api.patch({ guideLines: guideBox.checked }));
    root.append(guideRow);

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
    const hint = document.createElement('div');
    hint.className = 'pop-hint';
    hint.textContent = window.Iro.t('module.slices.guideLock');
    root.append(hint);

    // The inner shape only exists where the slice square is itself the gamut
    // (Okhsv/Okhsl); OKLCH always shows its flat L×C slice. `id` is the model just
    // picked, because api.get() may not reflect the patch yet.
    const syncShapeRow = (id) => {
      shapeRow.classList.toggle('hidden', !SHAPED_MODELS.includes(id || api.get().model));
    };
    syncShapeRow();
  };

  reg.modules['color-wheel'] = {
    id: 'color-wheel',
    name: 'Color Wheel',
    version: 2,
    defaults: {
      model: 'oklch', shape: 'triangle', ringWidth: 0.12, hideNumbers: false,
      guideLines: true, hueRotation: 0, innerRotate: 0, innerFlipH: false, innerFlipV: false,
    },
    settingsUI,
    minSize() { return { width: 128, height: 128 }; },

    create(ctx) {
      const Color = window.Color;
      const store = ctx.color;
      const Input = window.IroInputReset;
      const WHEEL = Models.listForFamily(store.viewFamily || 'all')
        .filter((m) => WHEEL_MODELS.includes(m.id));

      let modelId = WHEEL.some((m) => m.id === ctx.settings.get().model) ? ctx.settings.get().model : 'oklch';
      let shape = ctx.settings.get().shape === 'square' ? 'square' : 'triangle';
      let ringWidth = clamp(Number(ctx.settings.get().ringWidth) || 0.12, 0.06, 0.22);
      let hideNumbers = ctx.settings.get().hideNumbers === true;
      let guideLines = ctx.settings.get().guideLines !== false;
      let hueRotation = ((Number(ctx.settings.get().hueRotation) || 0) % 360 + 360) % 360;
      let innerRotate = ((Number(ctx.settings.get().innerRotate) || 0) % 360 + 360) % 360;
      let innerFlipH = ctx.settings.get().innerFlipH === true;
      let innerFlipV = ctx.settings.get().innerFlipV === true;

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

      const modelNow = () => {
        const chosen = Models.get(modelId);
        if (chosen && WHEEL_MODELS.includes(chosen.id)
          && Models.inFamily(chosen, store.viewFamily || 'all')) return chosen;
        return Models.get(Models.defaultForFamily(store.viewFamily || 'all')) || Models.get('oklch');
      };

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

      const split = clamp(RING_SPLIT, 0.2, 0.8);
      const geometry = (w, h) => {
        const size = Math.min(w, h);
        const outer = Math.max(0, size / 2 - 2);
        const ringW = Math.min(Math.max(size * ringWidth, 10), Math.max(1, size * 0.25));
        // The ring's hole (where its inner band ends) and the slightly smaller circle
        // the inner slice is inscribed in. The two bands meet at the hole; only the
        // slice keeps the gap, so the ring reads as one ring and the slice never
        // touches it.
        const hole = Math.max(0, outer - ringW);
        const gap = Math.min(6, Math.max(3, size * 0.02));
        return {
          cx: w / 2, cy: h / 2, outer, ringW, gap, hole,
          inner: hole,
          slice: Math.max(0, hole - gap),
          outerW: ringW * split,
          innerW: ringW * (1 - split),
        };
      };

      // --- ring --------------------------------------------------------------
      const ringCache = new Map();

      // A fixed-lightness ring is the only *continuous* pure-hue reference here.
      // OKHSV's S=1/V=1 path follows the sRGB blue fin and jumps at the primary
      // (green 61 -> 0 in one step); a constant-L gamut edge has no such seam.
      const RING_OUTER_L = 0.7;
      const RING_HELM_L = 0.65;
      const ringColor = (model, hue, light) => {
        if (model.id === 'helmgenlch') {
          const axes = [0, 0, 0];
          axes[hueIndexOf(model)] = hue;
          axes[lightAxis(model)] = light;
          axes[1] = model.axes[1].max;
          const lab = model.toLab(axes);
          const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
          return Color.fitToSrgb(lch.L, lch.C, lch.H);
        }
        const L = clamp01(light);
        const C = Math.max(0, store.maxChroma(L, hue));
        return Color.fitToSrgb(L, C, hue);
      };

      /** The fixed outer band: the widest in-gamut colour at every hue. */
      const outerRingPlot = (w, h, geo, model) => {
        const key = `ringouter:${store.plotKeyTag()}:${model.id}:${ringWidth.toFixed(3)}:${split.toFixed(2)}:${w}x${h}`;
        const hit = ringCache.get(key);
        if (hit && hit.width === w && hit.height === h) return hit;
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        if (geo.outerW <= 0 || geo.outer <= 0) return off;
        // The stroke is a hair wider than its band on the inner side, so the two bands
        // overlap at their joint: compositing two separately drawn anti-aliased edges
        // leaves a white hairline, which read as a gap between the rings.
        const pad = 1.5;
        const radius = geo.outer - (geo.outerW + pad) / 2;
        const light = model.id === 'helmgenlch' ? RING_HELM_L : RING_OUTER_L;
        for (let deg = 0; deg < 360; deg += 1) {
          const rgb = ringColor(model, deg, light);
          const a0 = (deg - 0.4) * Math.PI / 180;
          const a1 = (deg + 1.4) * Math.PI / 180;
          c2d.beginPath();
          c2d.arc(geo.cx, geo.cy, radius, a0, a1);
          c2d.strokeStyle = `rgb(${clamp255(rgb.r * 255)},${clamp255(rgb.g * 255)},${clamp255(rgb.b * 255)})`;
          c2d.lineWidth = geo.outerW + pad;
          c2d.stroke();
        }
        if (ringCache.size > 12) ringCache.clear();
        ringCache.set(key, off);
        return off;
      };

      /** The contextual inner band: the same hue at the selected OKLab L. */
      const innerRingPlot = (w, h, model, geo, third) => {
        // During a drag the band is a thin approximation: quantise the light to
        // 0.01 so moving the inner pointer does not rebuild 360 arcs per frame, and
        // hold the last band for a beat while a gesture is in flight (the raster's
        // own hold is in buildInner).
        const thirdPaint = store.interactive ? Math.round(third * 100) / 100 : third;
        const lightAxes = currentAxes();
        lightAxes[lightAxis(model)] = thirdPaint;
        const lightLab = model.toLab(lightAxes);
        const lch = Color.oklabToOklch(lightLab.L, lightLab.a, lightLab.b);
        const key = `ringinner:${store.plotKeyTag()}:${model.id}:${thirdPaint.toFixed(3)}:${lch.L.toFixed(4)}:${ringWidth.toFixed(3)}:${split.toFixed(2)}:${w}x${h}`;
        const hit = ringCache.get(key);
        if (hit && hit.width === w && hit.height === h) return hit;
        const now = performance.now();
        if (store.interactive && lastInnerRing && now - innerRingBuilt < 200) return lastInnerRing;
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        if (geo.innerW <= 0 || geo.inner <= 0) return off;
        const pad = 1.5;
        const radius = geo.inner + (geo.innerW + pad) / 2;
        const light = model.id === 'helmgenlch' ? thirdPaint : lch.L;
        for (let deg = 0; deg < 360; deg += 1) {
          const rgb = ringColor(model, deg, light);
          const a0 = (deg - 0.4) * Math.PI / 180;
          const a1 = (deg + 1.4) * Math.PI / 180;
          c2d.beginPath();
          c2d.arc(geo.cx, geo.cy, radius, a0, a1);
          c2d.strokeStyle = `rgb(${clamp255(rgb.r * 255)},${clamp255(rgb.g * 255)},${clamp255(rgb.b * 255)})`;
          c2d.lineWidth = geo.innerW + pad;
          c2d.stroke();
        }
        if (ringCache.size > 12) ringCache.clear();
        ringCache.set(key, off);
        lastInnerRing = off;
        innerRingBuilt = now;
        return off;
      };

      // --- inner shape -------------------------------------------------------
      const innerCache = new Map();
      let lastInner = null;
      let innerBuilt = 0;
      let innerHoldUntil = 0;
      let lastInnerRing = null;
      let innerRingBuilt = 0;

      /** The cusp of the hue slice, cached per hue/held axis. */
      const cuspCache = new Map();
      const cuspFor = (model, hue, third) => {
        const key = `${model.id}:${hue.toFixed(1)}:${Number(third).toFixed(3)}`;
        const hit = cuspCache.get(key);
        if (hit !== undefined) return hit;
        const light = lightAxis(model);
        const hIdx = hueIndexOf(model);
        const sample = (a) => {
          const axes = [0, 0, 0];
          axes[hIdx] = hue;
          if (model.id === 'oklch') {
            const L = a;
            axes[0] = L;
            axes[2] = hue;
            const ivs = store.chromaIntervals(L, hue);
            const C = ivs.length ? ivs[ivs.length - 1][1] : 0;
            return { b: C / G.range(model, 1, store).max, chroma: C };
          }
          const r = G.range(model, light, store);
          axes[light] = r.min + a * (r.max - r.min);
          axes[1] = model.axes[1].max;
          const lab = model.toLab(axes);
          return { b: 1, chroma: Math.hypot(lab.a, lab.b) };
        };
        const out = Pj ? Pj.findCusp(sample) : null;
        if (cuspCache.size > 32) cuspCache.clear();
        cuspCache.set(key, out);
        return out;
      };

      const innerProj = (model, hue) => {
        if (!Pj) return null;
        // OKLCH always draws its L×C slice flat, whatever the shape setting says:
        // the lens has to be seen whole, so there is no triangle for it.
        if (!SHAPED_MODELS.includes(model.id) || shape !== 'triangle') return Pj.flat;
        // Okhsv's triangle has fixed corners (its V/S square *is* the gamut);
        // Okhsl gets the cusp frame, whose apex follows the hue.
        if (model.id === 'okhsv') return Pj.triangleFixed();
        const cusp = cuspFor(model, hue, currentAxes()[lightAxis(model)]);
        return (cusp && Pj.triangle(cusp)) || Pj.flat;
      };

      const innerView = () => (SV ? SV.composeView(innerRotate, innerFlipH, innerFlipV) : null);

      const buildInner = (w, h, model, hue, proj, box, scale = 2) => {
        const cuspKey = proj && proj.cusp ? `${proj.cusp.a.toFixed(3)},${proj.cusp.b.toFixed(3)}` : (proj ? proj.id : 'f');
        const axes = currentAxes();
        // Plane 0 is the fixed-hue plane: its pixel colours depend on that one fixed
        // axis, not on the selected lightness or chroma. Keying on all three axes
        // (the old key) rebuilt the whole inner shape on every lightness drag.
        const [,, fi] = Models.planesFor(model)[0];
        const fixedKey = Number.isFinite(axes[fi]) ? axes[fi].toFixed(4) : 'x';
        const s = Math.max(1, Math.round(scale));
        const key = `inner:${store.plotKeyTag()}:${model.id}:${shape}:${hue.toFixed(1)}:${fixedKey}:${s}:${w}x${h}:${box.x.toFixed(1)},${box.y.toFixed(1)},${box.w.toFixed(1)},${box.h.toFixed(1)}:${cuspKey}`;
        const hit = innerCache.get(key);
        if (hit && hit.width === w / s && hit.height === h / s) return hit;
        // While a gesture is in flight the build is paced by its own measured cost, so
        // a ring drag updates the inner slice as fast as the model allows.
        const now = performance.now();
        if (store.interactive && lastInner && now < innerHoldUntil) return lastInner;
        const started = performance.now();
        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.round(w / s));
        off.height = Math.max(1, Math.round(h / s));
        const c2d = off.getContext('2d');
        const img = c2d.createImageData(off.width, off.height);
        const data = img.data;
        axes[hueIndexOf(model)] = hue;
        const bw = box.w / s, bh = box.h / s, bx = box.x / s, by = box.y / s;
        const workingGamut = store.useWorkingGamut()
          ? (lab) => {
            const l = Color.oklabToOklch(lab.L, lab.a, lab.b);
            return store.inGamut(l.L, l.C, l.H);
          }
          : null;
        const px = new Uint8ClampedArray(4);
        const labOut = { L: 0, a: 0, b: 0 };
        for (let y = 0; y < bh; y += 1) {
          const yN = y / Math.max(1, bh - 1);
          for (let x = 0; x < bw; x += 1) {
            const xN = x / Math.max(1, bw - 1);
            let un = xN;
            let vn = 1 - yN;
            if (proj && proj.id !== 'flat') {
              const m = proj.fromScreen(xN, yN);
              if (!m || m.inside === false) continue;
              un = m.u;
              vn = m.v;
            }
            const a = G.pickAxes(model, 0, un, vn, axes, store);
            const lab = model.toLab(a);
            // Models with their own domain predicate keep it; everyone else uses
            // the shared fast chain (one conversion, LUT gamma, no fitToSrgb for
            // the common in-sRGB pixel) — the same predicate as the pick.
            if (typeof model.inGamut === 'function') {
              if (!model.inGamut(a)) continue;
              const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
              const rgb = Color.fitToSrgb(lch.L, lch.C, lch.H);
              px[0] = clamp255(rgb.r * 255);
              px[1] = clamp255(rgb.g * 255);
              px[2] = clamp255(rgb.b * 255);
              px[3] = 255;
            } else if (Raster && typeof Raster.pixelFromLab === 'function') {
              labOut.L = lab.L; labOut.a = lab.a; labOut.b = lab.b;
              Raster.pixelFromLab(labOut, px, workingGamut);
              if (!px[3]) continue;
            } else {
              const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
              if (!G.inside(model, a, store)) continue;
              const rgb = Color.fitToSrgb(lch.L, lch.C, lch.H);
              px[0] = clamp255(rgb.r * 255);
              px[1] = clamp255(rgb.g * 255);
              px[2] = clamp255(rgb.b * 255);
              px[3] = 255;
            }
            const row = Math.round(by) + y;
            const col = Math.round(bx) + x;
            if (row < 0 || col < 0 || row >= off.height || col >= off.width) continue;
            const i = (row * off.width + col) * 4;
            data[i] = px[0];
            data[i + 1] = px[1];
            data[i + 2] = px[2];
            data[i + 3] = 255;
          }
        }
        c2d.putImageData(img, 0, 0);
        if (innerCache.size > 8) innerCache.clear();
        innerCache.set(key, off);
        if (store.interactive) innerHoldUntil = performance.now() + Cadence.holdFor(performance.now() - started);
        else innerHoldUntil = 0;
        lastInner = off;
        innerBuilt = now;
        return off;
      };

      // --- layout helpers -----------------------------------------------------
      /** The inner control's box inside the panel, in device pixels. */
      const innerBox = (geo, proj) => {
        if (proj && String(proj.id).startsWith('triangle')) {
          // The slice's bounding square: the triangle vertices are on the inscribed
          // circle in these normalized coordinates.
          return { x: geo.cx - geo.slice, y: geo.cy - geo.slice, w: geo.slice * 2, h: geo.slice * 2 };
        }
        const half = geo.slice / Math.SQRT2;
        return { x: geo.cx - half, y: geo.cy - half, w: half * 2, h: half * 2 };
      };

      /** Slice coordinates of the current colour. */
      const currentAxes = () => Models.axesFor(modelNow(), store);

      const metricsOf = () => {
        const r = canvas.getBoundingClientRect();
        return {
          left: r.left, top: r.top,
          clientLeft: canvas.clientLeft, clientTop: canvas.clientTop,
          clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight,
        };
      };

      const projectPoint = (proj, box, u, v) => {
        const sp = proj ? proj.toScreen(u, v) : { x: u, y: 1 - v };
        return { x: box.x + sp.x * (box.w - 1), y: box.y + sp.y * (box.h - 1) };
      };

      /** Project, then apply the inner display view (rotate/flip). */
      const viewPoint = (proj, box, u, v) => {
        const p = projectPoint(proj, box, u, v);
        const view = innerView();
        if (!SV || !view || SV.isIdentity(view)) return p;
        const xN = (p.x - box.x) / Math.max(1, box.w - 1);
        const yN = (p.y - box.y) / Math.max(1, box.h - 1);
        const t = SV.forward(view, xN, yN);
        return { x: box.x + t.u * (box.w - 1), y: box.y + t.v * (box.h - 1) };
      };

      const drawInner = (c2d, off, box, w, h) => {
        const view = innerView();
        c2d.save();
        c2d.beginPath();
        c2d.rect(box.x, box.y, box.w, box.h);
        c2d.clip();
        if (SV && view && !SV.isIdentity(view)) {
          const cx = box.x + box.w / 2;
          const cy = box.y + box.h / 2;
          c2d.translate(cx, cy);
          // Canvas applies the last transform first: flip, then rotate, so this
          // matches SV.forward() (rotate, then flip in display space).
          c2d.scale(view.flipH ? -1 : 1, view.flipV ? -1 : 1);
          c2d.rotate((view.rotate * Math.PI) / 180);
          c2d.translate(-cx, -cy);
        }
        // An interactive build is at native device pixels and scaled up here (smooth:
        // it is a gradient map, and this is not a block-filled map).
        c2d.imageSmoothingEnabled = true;
        c2d.drawImage(off, 0, 0, off.width, off.height, 0, 0, w, h);
        c2d.restore();
      };

      // --- pointer ------------------------------------------------------------
      let active = null; // 'ring' | 'inner'
      let startAxes = null;
      let lockLight = null;
      let resetCleanup = null;

      const applyAt = (ev) => {
        const at = G.contentPoint(metricsOf(), ev.clientX, ev.clientY);
        const px = at.x * canvas.width;
        const py = at.y * canvas.height;
        const geo = geometry(canvas.width, canvas.height);
        const model = modelNow();
        const hIdx = hueIndexOf(model);
        const axes = (startAxes || currentAxes()).slice();
        if (active === 'ring') {
          let deg = (Math.atan2(py - geo.cy, px - geo.cx) * 180) / Math.PI;
          if (deg < 0) deg += 360;
          axes[hIdx] = (deg - hueRotation + 360) % 360;
          // Keep the current chroma/saturation: the ring only turns the hue.
          const held = lockLight !== null ? G.setLightness(model, axes, lockLight, store) : axes;
          if (lockLight !== null && !G.lightnessReached(model, held, lockLight)) return;
          // A grey has no hue of its own, so without naming the anchor the store keeps
          // the old one and the ring cannot be turned. Probe the model at a tiny chroma
          // to get an OKLCH hue (what the anchor stores), then set both.
          const probe = held.slice();
          if (Math.abs(probe[1]) < 1e-6) probe[1] = model.axes[1].max * 1e-3;
          const pLab = model.toLab(probe);
          const hueOKLCH = Color.oklabToOklch(pLab.L, pLab.a, pLab.b).H;
          store.setLab(model.toLab(held), { notify: 'live', hue: hueOKLCH });
          return;
        }
        const proj = innerProj(model, axes[hIdx]);
        const box = innerBox(geo, proj);
        let xN = clamp((px - box.x) / (box.w - 1), 0, 1);
        let yN = clamp((py - box.y) / (box.h - 1), 0, 1);
        const view = innerView();
        if (SV && view && !SV.isIdentity(view)) {
          const inv = SV.inverse(view, xN, yN);
          xN = inv.u;
          yN = inv.v;
        }
        let un = xN;
        let vn = 1 - yN;
        if (proj && proj.id !== 'flat') {
          // Outside the drawn shape the pick is the *nearest* point on it: the affine
          // inverse alone clamps its axes and slides along one edge ("the pointer only
          // follows the horizontal position").
          const m = (Pj && Pj.pickInside)
            ? Pj.pickInside(proj, xN, yN)
            : proj.fromScreen(xN, yN);
          if (!m) return;
          un = clamp01(m.u);
          vn = clamp01(m.v);
        }
        // The hue is the one the drag started with — this branch only writes the two
        // free axes (slice-geometry#pickAxes keeps the rest), so an inner drag can never
        // turn the hue, however far the cursor wanders.
        let a = G.pickAxes(model, 0, un, vn, axes, store);
        if (lockLight !== null) {
          const held = G.applyLightness(model, 0, a, lockLight, store);
          if (!G.lightnessReached(model, held, lockLight)) return;
          a = held;
        }
        store.setLab(model.toLab(a), { notify: 'live', snap: true });
      };

      const attach = () => {
        canvas.addEventListener('pointerdown', (ev) => {
          const at = G.contentPoint(metricsOf(), ev.clientX, ev.clientY);
          const px = at.x * canvas.width;
          const py = at.y * canvas.height;
          const geo = geometry(canvas.width, canvas.height);
          const d = Math.hypot(px - geo.cx, py - geo.cy);
          if (d <= geo.slice) active = 'inner';
          else if (d <= geo.outer + 2) active = 'ring';
          else return;
          store.dragging = true;
          startAxes = currentAxes();
          lockLight = ev.shiftKey ? G.lightnessOf(modelNow(), startAxes) : null;
          if (Input) Input.capture(canvas, ev.pointerId);
          applyAt(ev);
          ev.preventDefault();
        });
        canvas.addEventListener('pointermove', (ev) => {
          if (!active) return;
          if (ev.shiftKey && lockLight === null) {
            lockLight = G.lightnessOf(modelNow(), currentAxes());
          } else if (!ev.shiftKey && lockLight !== null) {
            lockLight = null;
          }
          applyAt(ev);
        });
        const end = () => {
          if (!active) return;
          active = null;
          startAxes = null;
          lockLight = null;
          store.dragging = false;
          if (Input) Input.releaseAll();
          store.setLCH(store.lch(), { notify: 'commit' });
          schedule();
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        const onReset = () => {
          if (!active) return;
          active = null;
          startAxes = null;
          lockLight = null;
          store.dragging = false;
          if (Input) Input.releaseAll();
          schedule();
        };
        window.addEventListener('iro:input-reset', onReset);
        resetCleanup = () => window.removeEventListener('iro:input-reset', onReset);
      };

      // --- overlay ------------------------------------------------------------
      const drawGuide = (c2d, model, axes, proj, box, scale) => {
        if (!guideLines) return;
        const target = lockLight != null ? lockLight : G.lightnessOf(model, axes);
        const curve = G.guideCurve(model, 0, target, axes, store, 48);
        if (!curve) return;
        // Only the part of the contour that is (a) reachable — `flags` is the gamut
        // test, the same one the raster paints with — and (b) inside the shape the
        // projection actually shows. A cusp triangle covers a subset of the (u,v)
        // plane, so an unclipped contour ran out over the page and appeared to stop
        // in mid-air (the "guide gets cut off" report).
        const segments = [];
        let cur = null;
        const push = () => { if (cur && cur.length > 1) segments.push(cur); cur = null; };
        for (let i = 0; i < curve.points.length; i += 1) {
          const t = curve.points[i];
          let shown = Boolean(curve.flags[i]);
          if (shown && proj && typeof proj.fromScreen === 'function' && proj.id !== 'flat') {
            const raw = projectPoint(proj, box, t.u, t.v);
            const nx = (raw.x - box.x) / Math.max(1, box.w - 1);
            const ny = (raw.y - box.y) / Math.max(1, box.h - 1);
            const m = proj.fromScreen(nx, ny);
            shown = Boolean(m && m.inside !== false);
          }
          if (!shown) { push(); continue; }
          const p = viewPoint(proj, box, t.u, t.v);
          if (!cur) cur = [];
          cur.push([p.x, p.y]);
        }
        push();
        c2d.save();
        c2d.beginPath();
        c2d.rect(box.x, box.y, box.w, box.h);
        c2d.clip();
        Overlay.guide(c2d, segments, { locked: lockLight !== null, scale });
        c2d.restore();
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
        const dpr = w / Math.max(1, canvas.clientWidth);
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

        // Two bands: a fixed outer reference and a contextual inner ring.
        const outer = outerRingPlot(w, h, geo, model);
        const innerRing = innerRingPlot(w, h, model, geo, third);
        c2d.save();
        if (hueRotation) {
          c2d.translate(geo.cx, geo.cy);
          c2d.rotate((hueRotation * Math.PI) / 180);
          c2d.translate(-geo.cx, -geo.cy);
        }
        c2d.drawImage(outer, 0, 0);
        c2d.drawImage(innerRing, 0, 0);
        c2d.restore();
        // The two bands meet exactly (`outer - outerW === inner + innerW`), so no
        // separator is drawn: they read as one ring.

        const proj = innerProj(model, hue);
        const box = innerBox(geo, proj);
        // Supersampled when idle, native device pixels while a gesture is in flight:
        // the map must never stall the pointer, and it stays 1:1 with the screen.
        const innerScale = store.interactive ? Math.max(1, Math.round(dpr)) : 1;
        drawInner(c2d, buildInner(w, h, model, hue, proj, box, innerScale), box, w, h);

        // The single lightness guide through the selected colour.
        drawGuide(c2d, model, axes, proj, box, dpr);

        // The hue pointer sits on the fixed outer band and uses the same small
        // transparent-centre ring as the Color Slider.
        const a = ((hue + hueRotation) * Math.PI) / 180;
        const ringRadius = geo.outer - geo.outerW / 2;
        const cxr = geo.cx + ringRadius * Math.cos(a);
        const cyr = geo.cy + ringRadius * Math.sin(a);
        const tr = 5.5 * dpr;
        c2d.beginPath();
        c2d.arc(cxr, cyr, tr, 0, Math.PI * 2);
        c2d.fillStyle = 'rgba(255,255,255,0.16)';
        c2d.fill();
        c2d.lineWidth = 1.5 * dpr;
        c2d.strokeStyle = '#111';
        c2d.stroke();
        c2d.beginPath();
        c2d.arc(cxr, cyr, Math.max(1, tr - 1.2 * dpr), 0, Math.PI * 2);
        c2d.lineWidth = Math.max(1, 0.9 * dpr);
        c2d.strokeStyle = '#fff';
        c2d.stroke();

        const clamped = G.clampAxes(model, axes, store);
        const pt = G.pointOf(model, 0, clamped.axes, store);
        const p = viewPoint(proj, box, pt.u, pt.v);
        Overlay.pointer(c2d, p.x, p.y, { clamped: clamped.clamped, scale: dpr });

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
            const nextModel = WHEEL.some((m) => m.id === settings.model) ? settings.model : 'oklch';
            if (nextModel !== modelId) {
              modelId = nextModel;
              ringCache.clear();
              innerCache.clear();
              cuspCache.clear();
              lockLight = null;
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
            const next = clamp(Number(settings.ringWidth) || 0.12, 0.06, 0.22);
            if (next !== ringWidth) {
              ringWidth = next;
              ringCache.clear();
            }
          }
          if (settings.hideNumbers !== undefined) hideNumbers = settings.hideNumbers === true;
          if (settings.guideLines !== undefined) guideLines = settings.guideLines !== false;
          if (settings.hueRotation !== undefined) hueRotation = ((Number(settings.hueRotation) || 0) % 360 + 360) % 360;
          if (settings.innerRotate !== undefined) innerRotate = ((Number(settings.innerRotate) || 0) % 360 + 360) % 360;
          if (settings.innerFlipH !== undefined) innerFlipH = settings.innerFlipH === true;
          if (settings.innerFlipV !== undefined) innerFlipV = settings.innerFlipV === true;
          footer.classList.toggle('hidden', hideNumbers);
          schedule();
        },
        settings(root) { settingsUI(ctx.settings, root, ctx.color); },
        destroy() {
          if (resetCleanup) resetCleanup();
          unsubscribe();
          if (rafId) cancelAnimationFrame(rafId);
        },
      };
    },
  };
})();

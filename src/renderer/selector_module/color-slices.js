'use strict';

// Selector module: the colour-slice picker. By default the three gamut slices at
// the current colour, in OKLCH:
//   * Lightness  : Lightness x Chroma at the current hue
//   * Chroma     : Hue x Chroma at the current lightness
//   * Hue        : Hue x Lightness at the current chroma
// Each slice is a silhouette: the coloured area is exactly the in-gamut region.
//
// The three panels are the active model's three planes (color-models.js#PLANES).
// OKLCH keeps its analytic silhouette renderer (exact, and it draws the primary
// fin); any other model rasterises the plane and tests the working gamut per
// pixel. The canonical value is never a model's own axes — the module reads the
// store's OKLab and writes it back through the model.

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};
  const Models = window.IroColorModels;

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp255 = (x) => clamp(Math.round(x), 0, 255);

  /** The slice settings UI, shared by the popover and the Settings window. */
  const settingsUI = (api, root) => {
    const addToggle = (key, label) => {
      const row = document.createElement('label');
      row.className = 'pop-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = api.get()[key] !== false;
      const name = document.createElement('span');
      name.textContent = label;
      row.append(box, name);
      box.addEventListener('change', () => api.patch({ [key]: box.checked }));
      root.append(row);
    };
    const modelRow = document.createElement('label');
    modelRow.className = 'pop-row';
    const modelName = document.createElement('span');
    modelName.textContent = window.Iro.t('module.settings.model');
    const sel = document.createElement('select');
    sel.className = 'pop-select';
    for (const m of Models.list()) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      sel.append(opt);
    }
    sel.value = Models.has(api.get().model) ? api.get().model : Models.DEFAULT_ID;
    sel.addEventListener('change', () => api.patch({ model: sel.value }));
    modelRow.append(modelName, sel);
    root.append(modelRow);

    const addSliceRow = (showKey, label, index) => {
      const row = document.createElement('div');
      row.className = 'pop-row slice-view-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = api.get()[showKey] !== false;
      const name = document.createElement('span');
      name.textContent = label;
      const rotKey = `slice${index}Rotate`;
      const flipHKey = `slice${index}FlipH`;
      const flipVKey = `slice${index}FlipV`;
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
      const refresh = () => {
        const current = api.get();
        const angle = ((Number(current[rotKey]) || 0) % 360 + 360) % 360;
        const h = current[flipHKey] === true;
        const v = current[flipVKey] === true;
        rot.title = `Rotate ${label} 90\u00b0 (now ${angle}\u00b0)`;
        rot.setAttribute('aria-label', rot.title);
        flipH.title = `Flip ${label} horizontally`;
        flipH.setAttribute('aria-label', flipH.title);
        flipV.title = `Flip ${label} vertically`;
        flipV.setAttribute('aria-label', flipV.title);
        flipH.classList.toggle('active', h);
        flipV.classList.toggle('active', v);
      };
      box.addEventListener('change', () => api.patch({ [showKey]: box.checked }));
      rot.addEventListener('click', () => {
        const angle = ((Number(api.get()[rotKey]) || 0) + 90) % 360;
        api.patch({ [rotKey]: angle }, { immediate: true });
        refresh();
      });
      flipH.addEventListener('click', () => {
        api.patch({ [flipHKey]: api.get()[flipHKey] !== true }, { immediate: true });
        refresh();
      });
      flipV.addEventListener('click', () => {
        api.patch({ [flipVKey]: api.get()[flipVKey] !== true }, { immediate: true });
        refresh();
      });
      row.append(box, name, rot, flipH, flipV);
      root.append(row);
      refresh();
    };

    addSliceRow('constantHue', 'Slice 1', 1);
    addSliceRow('constantLightness', 'Slice 2', 2);
    addSliceRow('constantChroma', 'Slice 3', 3);
    addToggle('guideLines', 'Lightness guides');
    const addRange = (key, label, min, max, step, fallback) => {
      const row = document.createElement('label');
      row.className = 'pop-row pop-row-range';
      const name = document.createElement('span');
      name.textContent = label;
      const rng = document.createElement('input');
      rng.type = 'range';
      rng.className = 'pop-range';
      rng.min = String(min);
      rng.max = String(max);
      rng.step = String(step);
      const value = Number(api.get()[key]);
      rng.value = String(Number.isFinite(value) ? value : fallback);
      const out = document.createElement('span');
      out.className = 'pop-range-value';
      out.textContent = String(rng.value);
      rng.addEventListener('input', () => { api.patch({ [key]: Number(rng.value) }); out.textContent = rng.value; });
      row.append(name, rng, out);
      root.append(row);
    };
    addRange('guideStep', 'Guide spacing', 0.01, 0.25, 0.01, 0.05);
    addToggle('gamutWarning', 'sRGB gamut warning');
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
    const orient = document.createElement('label');
    orient.className = 'pop-row';
    const orientName = document.createElement('span');
    orientName.textContent = window.Iro.t('module.settings.orientation');
    const osel = document.createElement('select');
    osel.className = 'pop-select';
    for (const [value, text] of [['horizontal', 'Horizontal'], ['vertical', 'Vertical']]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      osel.append(opt);
    }
    osel.value = api.get().orientation === 'vertical' ? 'vertical' : 'horizontal';
    osel.addEventListener('change', () => api.patch({ orientation: osel.value }));
    orient.append(orientName, osel);
    root.append(orient);
  };

  reg.modules['color-slices'] = {
    id: 'color-slices',
    name: 'Color Slices',
    version: 4,
    defaults: {
      model: 'oklch', constantHue: true, constantLightness: true, constantChroma: true,
      guideLines: true, guideStep: 0.05, gamutWarning: false, hideNumbers: false, orientation: 'vertical',
      slice1Rotate: 0, slice1FlipH: false, slice1FlipV: false,
      slice2Rotate: 0, slice2FlipH: false, slice2FlipV: false,
      slice3Rotate: 0, slice3FlipH: false, slice3FlipV: false,
    },
    migrate(stored) {
      // v2 had a single "hueSlice" flag, which is now the Constant Chroma slice.
      if (stored && stored.hueSlice === false && stored.constantChroma === undefined) {
        return { ...stored, constantChroma: false, hueSlice: undefined };
      }
      return stored;
    },
    settingsUI,
    /** The smallest box that shows everything (depends on visible panels). */
    minSize(settings) {
      const panels = ['constantHue', 'constantLightness', 'constantChroma']
        .filter((key) => settings[key] !== false).length || 1;
      return { width: 120, height: 34 + panels * 60 };
    },

    create(ctx) {
      const Color = window.Color;
      const store = ctx.color;
      const SV = window.IroSliceView;
      const identity = SV ? SV.composeView(0, false, false) : { rotate: 0, flipH: false, flipV: false };
      const panelViews = [identity, identity, identity];
      const viewFor = (p) => panelViews[p] || identity;
      const point = (p, u, v) => (SV ? SV.forward(viewFor(p), u, v) : { u, v });

      // Plot caches depend on the gamut *and* the profile identity, so a profile
      // switch cannot leave a stale silhouette behind (the key tag covers it).
      const plotCache = new Map();
      // The last-built map per panel and when; while dragging the map rebuilds at
      // most ~11/s so it stays full-resolution (guides must not thicken) and the
      // crosshair is redrawn every frame over the cached map.
      const lastOff = [null, null, null];
      const lastBuilt = [0, 0, 0];
      // The lightness of the colour the current drag started from: drawn as a red
      // guide line until the pointer is released.
      let dragL = null;

      const panels = document.createElement('div');
      panels.className = 'slice-panels';
      panels.dataset.orientation = 'vertical';
      ctx.el.append(panels);

      const panelSections = [];
      const panelCanvases = [];
      const makePanel = (canvasId) => {
        const section = document.createElement('section');
        section.className = 'panel';
        const canvas = document.createElement('canvas');
        canvas.className = 'plot';
        canvas.id = canvasId;
        canvas.dataset.plot = canvasId;
        section.append(canvas);
        panels.append(section);
        panelSections.push(section);
        panelCanvases.push(canvas);
        return { section, canvas };
      };

      const lc = makePanel('plot-lc');
      const hc = makePanel('plot-hc');
      const hue = makePanel('plot-hue');

      // One line at the very bottom of the module: the model's three axes.
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
      addValue('out-L');
      addValue('out-C');
      addValue('out-H');
      ctx.el.append(footer);

      // A model change re-labels the panels and footer; OKLCH keeps its names.
      let modelId = Models.DEFAULT_ID;
      const applyLabels = () => {
        const model = Models.get(modelId) || Models.get(Models.DEFAULT_ID);
        if (model.id === 'oklch') {
          panelSections[0].title = window.Iro.t('module.slices.hue');
    panelSections[1].title = window.Iro.t('module.slices.lightness');
    panelSections[2].title = window.Iro.t('module.slices.chroma');
        } else {
          for (let p = 0; p < 3; p++) {
            const fixed = Models.PLANES[p][2];
            panelSections[p].title = `${model.axes[fixed].label} Slice`;
          }
        }
        for (let i = 0; i < 3; i++) outLabels[i].textContent = model.axes[i].label;
      };

      let hideNumbers = false;
      let guideLines = true;
      let guideStep = 0.05;
      let gamutWarning = false;
      let narrow = false;
      const updateFooter = () => footer.classList.toggle('hidden', hideNumbers || narrow);

      const sizeCanvas = (canvas, cap = 2.5) => {
        // Supersample: at a 1x display a 1:1 canvas leaves a visibly jagged gamut
        // silhouette, so always render at least 2x (capped: the maps are rebuilt
        // while dragging). A raster plane is expensive, so it uses a lower cap.
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), cap);
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        return { w, h };
      };

      /**
       * Gamut silhouette: the in-gamut chroma intervals per column, filled.
       * A primary corner can be a thin fin (sub-pixel in chroma), so an interval
       * narrower than one row still gets a scanline — otherwise the corner would
       * be drawn as unreachable.
       */
      const buildPlot = (key, w, h, intervalsAt, colorAt, warnAt) => {
        const cached = plotCache.get(key);
        if (cached && cached.width === w && cached.height === h) return cached;

        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        const img = c2d.createImageData(w, h);
        const data = img.data;

        // In the working gamut but clipping in sRGB: a diagonal stripe (T4).
        const put = (i, x, y, C, r, g, b) => {
          if (gamutWarning && warnAt && warnAt(x / (w - 1), C) && ((x + y) & 7) < 3) {
            r = r * 0.5 + 115 * 0.5;
            g = g * 0.5 + 115 * 0.5;
            b = b * 0.5 + 115 * 0.5;
          }
          data[i] = clamp255(r); data[i + 1] = clamp255(g); data[i + 2] = clamp255(b); data[i + 3] = 255;
        };

        const cmax = store.cmax();
        const minC = cmax / Math.max(1, h - 1);
        const cols = new Array(w);
        for (let x = 0; x < w; x++) cols[x] = intervalsAt(x / (w - 1));

        for (let y = 0; y < h; y++) {
          const C = (1 - y / (h - 1)) * cmax;
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const ivs = cols[x];
            let inside = false;
            for (let k = 0; k < ivs.length; k++) {
              if (C >= ivs[k][0] && C <= ivs[k][1]) { inside = true; break; }
            }
            if (inside) {
              const { r, g, b } = colorAt(x / (w - 1), C);
              put(i, x, y, C, r, g, b);
            } else {
              data[i + 3] = 0;
            }
          }
        }

        // A sub-pixel-wide interval (a primary fin) still gets one scanline.
        for (let x = 0; x < w; x++) {
          const ivs = cols[x];
          for (let k = 0; k < ivs.length; k++) {
            const iv = ivs[k];
            if (iv[1] - iv[0] >= minC) continue;
            const y = clamp(Math.round((1 - iv[1] / cmax) * (h - 1)), 0, h - 1);
            const i = (y * w + x) * 4;
            const C = (1 - y / (h - 1)) * cmax;
            const { r, g, b } = colorAt(x / (w - 1), C);
            put(i, x, y, C, r, g, b);
          }
        }

        c2d.putImageData(img, 0, 0);
        plotCache.set(key, off);
        return off;
      };

      /** Hue slice: a per-pixel in-gamut mask at a fixed chroma. */
      const buildHuePlot = (key, w, h, C) => {
        const cached = plotCache.get(key);
        if (cached && cached.width === w && cached.height === h) return cached;

        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        const img = c2d.createImageData(w, h);
        const data = img.data;

        for (let y = 0; y < h; y++) {
          const L = 1 - y / (h - 1);
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const H = (x / (w - 1)) * 360;
            if (store.inGamut(L, C, H)) {
              const f = Color.oklchToRgb(L, C, H);
              let r = f.r * 255, g = f.g * 255, b = f.b * 255;
              if (gamutWarning && !Color.inGamut(L, C, H) && ((x + y) & 7) < 3) {
                r = r * 0.5 + 115 * 0.5; g = g * 0.5 + 115 * 0.5; b = b * 0.5 + 115 * 0.5;
              }
              data[i] = clamp255(r);
              data[i + 1] = clamp255(g);
              data[i + 2] = clamp255(b);
              data[i + 3] = 255;
            } else {
              data[i + 3] = 0;
            }
          }
        }
        c2d.putImageData(img, 0, 0);
        plotCache.set(key, off);
        return off;
      };

      const drawGuide = (c2d, w, h, x, y) => {
        c2d.save();
        c2d.lineWidth = 1;
        c2d.strokeStyle = 'rgba(0,0,0,0.55)';
        c2d.beginPath(); c2d.moveTo(x + 0.5, 0); c2d.lineTo(x + 0.5, h); c2d.stroke();
        c2d.beginPath(); c2d.moveTo(0, y + 0.5); c2d.lineTo(w, y + 0.5); c2d.stroke();
        c2d.strokeStyle = 'rgba(255,255,255,0.9)';
        c2d.beginPath(); c2d.moveTo(x, 0); c2d.lineTo(x, h); c2d.stroke();
        c2d.beginPath(); c2d.moveTo(0, y); c2d.lineTo(w, y); c2d.stroke();
        c2d.beginPath();
        c2d.arc(x, y, 5.5, 0, Math.PI * 2);
        c2d.lineWidth = 2; c2d.strokeStyle = '#111'; c2d.stroke();
        c2d.lineWidth = 1.5; c2d.strokeStyle = '#fff'; c2d.stroke();
        c2d.restore();
      };

      const paint = (canvas, off, w, h, view) => {
        const c2d = canvas.getContext('2d');
        c2d.save();
        c2d.setTransform(1, 0, 0, 1, 0, 0);
        c2d.clearRect(0, 0, canvas.width, canvas.height);
        // Scale the (possibly low-res, mid-drag) map up to the full canvas, so the
        // crosshair drawn on top stays crisp whatever the map resolution. The
        // display transform is applied here, not in the colour maths: the cached
        // plot stays canonical, and picking applies the inverse.
        const W = w || canvas.width;
        const H = h || canvas.height;
        const v = view || { rotate: 0, flipH: false, flipV: false };
        let matrix = [1, 0, 0, 1, 0, 0];
        if (SV && !SV.isIdentity(v)) {
          const f00 = SV.forward(v, 0, 0);
          const f10 = SV.forward(v, 1, 0);
          const f01 = SV.forward(v, 0, 1);
          const a = f10.u - f00.u;
          const c = f01.u - f00.u;
          const b = f10.v - f00.v;
          const d = f01.v - f00.v;
          matrix = [a, (H * b) / W, (W * c) / H, d, W * f00.u, H * f00.v];
        }
        c2d.setTransform(...matrix);
        c2d.drawImage(off, 0, 0, W, H);
        c2d.restore();
        return c2d;
      };

      // --- OKLCH: the analytic silhouette (unchanged) ------------------------

      const renderOklchPlots = () => {
        const { L, C, H } = store.lch();
        const cmax = store.cmax();

        // Lightness x Chroma at the current hue.
        {
          const canvas = lc.canvas;
          const { w, h } = sizeCanvas(canvas);
          const key = `lc:${store.plotKeyTag()}:${gamutWarning ? 1 : 0}:${H.toFixed(3)}`;
          const off = buildPlot(key, w, h,
            (xNorm) => store.chromaIntervals(clamp(xNorm, 0, 1), H),
            (xNorm, c) => {
              const f = Color.oklchToRgb(clamp(xNorm, 0, 1), c, H);
              return { r: clamp255(f.r * 255), g: clamp255(f.g * 255), b: clamp255(f.b * 255) };
            },
            (xNorm, c) => !Color.inGamut(clamp(xNorm, 0, 1), c, H));
          const c2d = paint(canvas, off, w, h, viewFor(0));
          if (store.crosshair) {
            const g = point(0, L, 1 - C / cmax);
            drawGuide(c2d, w, h, g.u * (w - 1), g.v * (h - 1));
          }
        }

        // Hue x Chroma at the current lightness.
        {
          const canvas = hc.canvas;
          const { w, h } = sizeCanvas(canvas);
          const key = `hc:${store.plotKeyTag()}:${gamutWarning ? 1 : 0}:${L.toFixed(3)}`;
          const off = buildPlot(key, w, h,
            (xNorm) => store.chromaIntervals(L, xNorm * 360),
            (xNorm, c) => {
              const f = Color.oklchToRgb(L, c, xNorm * 360);
              return { r: clamp255(f.r * 255), g: clamp255(f.g * 255), b: clamp255(f.b * 255) };
            },
            (xNorm, c) => !Color.inGamut(L, c, xNorm * 360));
          const c2d = paint(canvas, off, w, h, viewFor(1));
          if (store.crosshair) {
            const g = point(1, H / 360, 1 - C / cmax);
            drawGuide(c2d, w, h, g.u * (w - 1), g.v * (h - 1));
          }
        }

        // Hue x Lightness at the current chroma (the omitted slice).
        if (hue.section.classList.contains('hidden')) return;
        {
          const canvas = hue.canvas;
          const { w, h } = sizeCanvas(canvas);
          const key = `hue:${store.plotKeyTag()}:${gamutWarning ? 1 : 0}:${C.toFixed(3)}`;
          const off = buildHuePlot(key, w, h, C);
          const c2d = paint(canvas, off, w, h, viewFor(2));
          if (store.crosshair) {
            const g = point(2, H / 360, 1 - L);
            drawGuide(c2d, w, h, g.u * (w - 1), g.v * (h - 1));
          }
        }
      };

      // --- any other model: rasterise each plane against the working gamut ---

      const axisRange = (model, i) => Models.axisRange(model, i);

      const buildRasterPlot = (key, w, h, plane, axes, model) => {
        const cached = plotCache.get(key);
        if (cached && cached.width === w && cached.height === h) return cached;
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        const img = c2d.createImageData(w, h);
        const data = img.data;
        const [hi, vi, fi] = Models.PLANES[plane];
        const hr = axisRange(model, hi), vr = axisRange(model, vi);
        const fixed = axes[fi];
        const tmp = axes.slice();
        const guides = guideLines && model.id !== Models.DEFAULT_ID;
        // Outside the gamut stays transparent (like the analytic OKLCH silhouette):
        // the shape IS the gamut, so a hatch would only add noise. The sRGB warning
        // stays an explicit, opt-in hatch.
        // The perceptual lightness of every drawn pixel, for the guide contours.
        const luma = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
          const yN = y / (h - 1);
          for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const i = idx * 4;
            const un = x / (w - 1);
            const vn = 1 - yN;
            const u = hr.min + un * (hr.max - hr.min);
            const v = vr.min + vn * (vr.max - vr.min);
            tmp[hi] = u; tmp[vi] = v; tmp[fi] = fixed;
            const lab = model.toLab(tmp);
            const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
            const inside = model.dense || (typeof model.inGamut === 'function'
              ? model.inGamut(tmp)
              : store.inGamut(lch.L, lch.C, lch.H));
            if (inside) {
              const f = Color.oklabToRgb(lab.L, lab.a, lab.b);
              data[i] = clamp255(f.r * 255);
              data[i + 1] = clamp255(f.g * 255);
              data[i + 2] = clamp255(f.b * 255);
              data[i + 3] = 255;
              luma[idx] = lch.L;
            } else {
              data[i + 3] = 0;
              luma[idx] = NaN;
            }
          }
        }
        // Equal-lightness guides: an anti-aliased line at each multiple of the
        // guide step, sized in *screen* pixels by dividing the lightness gap by the
        // local gradient, so its width is uniform however fast the surface changes.
        // The line colour eases between light and dark with the surface luminance.
        if (guides) {
          const step = clamp(guideStep, 0.02, 0.5);
          const draggingNow = store.dragging;
          // While dragging, the guides are relative to the current colour (a line
          // through it and its +/-5% / +/-10% neighbours); otherwise the whole
          // slice is gridded at the spacing.
          const L0 = store.L;
          const at = (x, y) => {
            if (x < 0 || y < 0 || x >= w || y >= h) return null;
            const v = luma[y * w + x];
            return Number.isNaN(v) ? null : v;
          };
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = y * w + x;
              const L = luma[idx];
              if (Number.isNaN(L)) continue;
              const xl = at(x - 1, y);
              const xr = at(x + 1, y);
              const yu = at(x, y - 1);
              const yd = at(x, y + 1);
              const gx = (xr !== null && xl !== null) ? (xr - xl) / 2 : 0;
              const gy = (yd !== null && yu !== null) ? (yd - yu) / 2 : 0;
              const grad = Math.hypot(gx, gy);
              if (grad < 1e-6) continue;
              const i = idx * 4;
              const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
              // dark surface -> light line; light surface -> dark line, eased.
              const t = clamp((lum - 0.2) / 0.55, 0, 1);
              const line = 250 - t * 230;
              const blend = (a) => {
                data[i] = data[i] * (1 - a) + line * a;
                data[i + 1] = data[i + 1] * (1 - a) + line * a;
                data[i + 2] = data[i + 2] * (1 - a) + line * a;
              };
              if (draggingNow) {
                const k = Math.round((L - L0) / step);
                if (k >= -2 && k <= 2) {
                  const cov = clamp(1.4 - Math.abs(L - (L0 + k * step)) / grad, 0, 1);
                  if (cov > 0) blend(cov * (k === 0 ? 0.95 : 0.5));
                }
                if (dragL !== null) {
                  const cov = clamp(1.4 - Math.abs(L - dragL) / grad, 0, 1);
                  if (cov > 0) {
                    const a = cov * 0.85;
                    data[i] = data[i] * (1 - a) + 232 * a;
                    data[i + 1] = data[i + 1] * (1 - a) + 32 * a;
                    data[i + 2] = data[i + 2] * (1 - a) + 32 * a;
                  }
                }
              } else {
                const target = Math.round(L / step) * step;
                const cov = clamp(1.4 - Math.abs(L - target) / grad, 0, 1);
                if (cov > 0) blend(cov * 0.6);
              }
            }
          }
        }
        c2d.putImageData(img, 0, 0);
        plotCache.set(key, off);
        return off;
      };

      const renderGenericPlots = () => {
        const model = Models.get(modelId) || Models.get(Models.DEFAULT_ID);
        const axes = Models.axesFor(model, store);
        for (let p = 0; p < 3; p++) {
          const section = panelSections[p];
          if (section.classList.contains('hidden')) continue;
          const canvas = panelCanvases[p];
          const { w, h } = sizeCanvas(canvas, 1.5);
          const key = `g${p}:${store.plotKeyTag()}:${model.id}:${guideLines ? 1 : 0}:${guideStep}:${w}x${h}:${axes[0].toFixed(4)}:${axes[1].toFixed(4)}:${axes[2].toFixed(4)}`;
          const now = performance.now();
          let off = plotCache.get(key);
          if (!off || off.width !== w || off.height !== h) {
            // Mid-drag, rebuild at most every ~90 ms (full resolution, so the
            // baked guides keep their width); the crosshair still redraws each frame.
            const reuse = store.dragging && lastOff[p] && lastOff[p].width === w && lastOff[p].height === h && (now - lastBuilt[p] < 90);
            if (reuse) {
              off = lastOff[p];
            } else {
              off = buildRasterPlot(key, w, h, p, axes, model);
              lastOff[p] = off;
              lastBuilt[p] = now;
            }
          }
          const c2d = paint(canvas, off, w, h, viewFor(p));
          if (store.crosshair) {
            const [hi, vi] = Models.PLANES[p];
            const hr = axisRange(model, hi), vr = axisRange(model, vi);
            const su = (axes[hi] - hr.min) / (hr.max - hr.min);
            const sv = (axes[vi] - vr.min) / (vr.max - vr.min);
            const sp = { x: su, y: 1 - sv };
            const g = point(p, sp.x, sp.y);
            drawGuide(c2d, w, h, g.u * (w - 1), g.v * (h - 1));
          }
        }
      };

      const renderPlots = () => {
        if (modelId === Models.DEFAULT_ID) renderOklchPlots();
        else renderGenericPlots();
      };

      /** Trim the plot cache so it cannot grow without bound while dragging. */
      const prunePlotCache = () => {
        if (plotCache.size <= 8) return;
        const keys = [...plotCache.keys()];
        for (let i = 0; i < keys.length - 6; i++) plotCache.delete(keys[i]);
      };

      // --- interaction -------------------------------------------------------

      const attach = (canvas, apply, panelIndex) => {
        let active = false;
        const at = (ev) => {
          const rect = canvas.getBoundingClientRect();
          const xN = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
          const yN = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
          // The plot is drawn transformed; picking undoes exactly that transform,
          // so the pointer always lands on the colour it is over.
          const p = SV ? SV.inverse(viewFor(panelIndex), xN, yN) : { u: xN, v: yN };
          apply(p.u, p.v);
        };
        canvas.addEventListener('pointerdown', (ev) => {
          active = true;
          store.dragging = true;
          dragL = store.L;
          canvas.setPointerCapture(ev.pointerId);
          at(ev);
          ev.preventDefault();
        });
        canvas.addEventListener('pointermove', (ev) => { if (active) at(ev); });
        const end = () => {
          if (!active) return;
          active = false;
          store.dragging = false;
          dragL = null;
          store.setLCH(store.lch(), { notify: 'commit' });
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
      };

      /**
       * Nearest lightness (at this chroma and hue) that is inside the gamut. The
       * Hue slice holds chroma fixed, so an out-of-bound pick must be pulled back
       * along lightness rather than by desaturating.
       */
      const clampLToGamut = (L, C, H) => {
        if (store.inGamut(L, C, H)) return L;
        const steps = 64;
        let best = L;
        let bestD = Infinity;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          if (store.inGamut(t, C, H)) {
            const d = Math.abs(t - L);
            if (d < bestD) { bestD = d; best = t; }
          }
        }
        return best;
      };

      // Lightness / Chroma slices treat chroma as an axis, so a drag snaps it
      // back to the gamut boundary. The Hue slice holds chroma and clamps
      // lightness into the silhouette instead.
      attach(lc.canvas, (xN, yN) => {
        if (modelId !== Models.DEFAULT_ID) return genericPick(0, xN, yN);
        store.setLCH({ L: xN, C: (1 - yN) * store.cmax(), H: store.H }, { notify: 'live', snap: true });
      }, 0);
      attach(hc.canvas, (xN, yN) => {
        if (modelId !== Models.DEFAULT_ID) return genericPick(1, xN, yN);
        const C = (1 - yN) * store.cmax();
        // At zero chroma the hue is undefined: keep the anchor rather than the
        // pointer's x, so dragging chroma to the axis does not jump the hue.
        store.setLCH({ L: store.L, C, H: C < 1e-6 ? store.H : xN * 360 }, { notify: 'live', snap: true });
      }, 1);
      attach(hue.canvas, (xN, yN) => {
        if (modelId !== Models.DEFAULT_ID) return genericPick(2, xN, yN);
        const H = store.C < 1e-6 ? store.H : xN * 360;
        const L = clampLToGamut(1 - yN, store.C, H);
        store.setLCH({ L, C: store.C, H }, { notify: 'live' });
      }, 2);

      const genericPick = (plane, xN, yN) => {
        const model = Models.get(modelId) || Models.get(Models.DEFAULT_ID);
        const [hi, vi] = Models.PLANES[plane];
        const hr = Models.axisRange(model, hi), vr = Models.axisRange(model, vi);
        const axes = Models.axesFor(model, store);
        axes[hi] = hr.min + xN * (hr.max - hr.min);
        axes[vi] = vr.min + (1 - yN) * (vr.max - vr.min);
        store.setLab(model.toLab(axes), { notify: 'live', snap: true });
      };

      // --- render loop -------------------------------------------------------

      let rafId = 0;
      const schedulePlots = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          renderPlots();
          prunePlotCache();
        });
      };

      const render = () => {
        const model = Models.get(modelId) || Models.get(Models.DEFAULT_ID);
        const axes = Models.axesFor(model, store);
        for (let i = 0; i < 3; i++) {
          const def = model.axes[i];
          outNums[i].textContent = Models.formatAxis(def, axes[i]);
        }
        schedulePlots();
      };

      const unsubscribe = store.subscribe(render);
      applyLabels();
      render();

      return {
        onResize({ width }) {
          narrow = width < 150;
          updateFooter();
          renderPlots();
        },
        onSettings(settings) {
          const nextModel = Models.has(settings.model) ? settings.model : Models.DEFAULT_ID;
          if (nextModel !== modelId) {
            modelId = nextModel;
            plotCache.clear();
            applyLabels();
          }
          lc.section.classList.toggle('hidden', settings.constantHue === false);
          hc.section.classList.toggle('hidden', settings.constantLightness === false);
          hue.section.classList.toggle('hidden', settings.constantChroma === false);
          hideNumbers = settings.hideNumbers === true;
          guideLines = settings.guideLines !== false;
          guideStep = clamp(Number(settings.guideStep) || 0.05, 0.01, 0.5);
          gamutWarning = settings.gamutWarning === true;
          panels.dataset.orientation = settings.orientation === 'horizontal' ? 'horizontal' : 'vertical';
          panelViews[0] = SV ? SV.composeView(settings.slice1Rotate, settings.slice1FlipH, settings.slice1FlipV) : identity;
          panelViews[1] = SV ? SV.composeView(settings.slice2Rotate, settings.slice2FlipH, settings.slice2FlipV) : identity;
          panelViews[2] = SV ? SV.composeView(settings.slice3Rotate, settings.slice3FlipH, settings.slice3FlipV) : identity;
          updateFooter();
          renderPlots();
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

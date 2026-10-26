'use strict';

// Selector module: the colour-slice picker. By default the three gamut slices at
// the current colour, in OKLCH:
//   * L x C : the fixed-hue plane (Lightness x Chroma)
//   * H x C : the fixed-lightness plane
//   * H x L : the fixed-chroma plane
// Each slice is a silhouette: the coloured area is exactly the in-gamut region.
//
// The three panels are the active model's three planes (color-models.js#planesFor).
// OKLCH keeps its analytic silhouette renderer (exact, and it draws the primary
// fin); any other model rasterises the plane and tests the working gamut per
// pixel. The canonical value is never a model's own axes — the module reads the
// store's OKLab and writes it back through the model.
//
// The raster and the pointer share slice-geometry.js, so a pick can only land on
// a colour the panel shows. A drag pins its fixed axis for the whole gesture: a
// snap may move the colour along the gamut boundary but must not move the plane
// (that is what made HelmGen LCH's hue drift). Shift freezes the lightness axis.

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};
  const Models = window.IroColorModels;
  const G = window.IroSliceGeometry;
  const Overlay = window.IroPickerOverlay;

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp255 = (x) => clamp(Math.round(x), 0, 255);
  const clamp01 = (x) => clamp(x, 0, 1);

  const SHOW_KEYS = ['constantHue', 'constantLightness', 'constantChroma'];
  const PANEL_IDS = ['plot-lc', 'plot-hc', 'plot-hue'];
  const SRGB_LIMITED = ['okhsv', 'okhsl', 'okhwb'];
  /** True while the model is limited to sRGB by the *reference cube*, not by id alone. */
  const isLimited = (store, model) => (typeof store.modelLimited === 'function'
    ? store.modelLimited(model)
    : SRGB_LIMITED.includes(model.id));

  /** A stored order is a permutation of the model's three planes. */
  const normaliseOrder = (value) => {
    const out = [];
    if (Array.isArray(value)) {
      for (const v of value) {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0 && n <= 2 && !out.includes(n)) out.push(n);
      }
    }
    for (let i = 0; i < 3; i += 1) if (!out.includes(i)) out.push(i);
    return out;
  };

  /** The slice settings UI, shared by the popover and the Settings window. */
  const settingsUI = (api, root, store) => {
    const modelOf = (id) => {
      const chosen = Models.get(id);
      if (chosen && Models.inFamily(chosen, store.viewFamily || 'all')) return chosen;
      return Models.get(Models.defaultForFamily(store.viewFamily || 'all')) || Models.get(Models.DEFAULT_ID);
    };
    let currentModel = modelOf(api.get().model);
    const rows = []; // { el, label, plane, refresh }

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
    modelRow.append(modelName);
    window.IroModelOptions.menu(modelRow, {
      groups: window.IroModelOptions.groups(Models.listForFamily(store.viewFamily || 'all')),
      value: Models.inFamily(modelOf(api.get().model), store.viewFamily || 'all')
        ? modelOf(api.get().model).id
        : Models.defaultForFamily(store.viewFamily || 'all'),
      onChange: (id) => {
        currentModel = modelOf(id);
        api.patch({ model: id });
        refreshLabels();
      },
    });
    root.append(modelRow);

    // sRGB-referenced models cannot reach a wide document gamut; say so instead
    // of letting the crosshair vanish off their panel.
    const modelHint = document.createElement('div');
    modelHint.className = 'pop-hint slice-model-hint hidden';
    root.append(modelHint);

    const list = document.createElement('div');
    list.className = 'slice-rows';
    root.append(list);

    const displayOrder = () => [...list.children].map((el) => Number(el.dataset.plane));

    const makeRow = (plane) => {
      const showKey = SHOW_KEYS[plane];
      const row = document.createElement('div');
      row.className = 'pop-row slice-view-row';
      row.dataset.plane = String(plane);

      // The gripper sits next to the show/hide box, as requested.
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'icon-btn slice-grip';
      grip.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="3" r="1.2"/><circle cx="11" cy="3" r="1.2"/><circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/><circle cx="5" cy="13" r="1.2"/><circle cx="11" cy="13" r="1.2"/></svg>';
      grip.setAttribute('aria-label', window.Iro.t('module.slices.reorder'));
      grip.title = window.Iro.t('module.slices.reorder');

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = api.get()[showKey] !== false;
      box.setAttribute('aria-label', window.Iro.t('module.slices.show'));

      const name = document.createElement('span');
      name.className = 'slice-name';

      const rotKey = `slice${plane + 1}Rotate`;
      const flipHKey = `slice${plane + 1}FlipH`;
      const flipVKey = `slice${plane + 1}FlipV`;
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
        const label = Models.planeLabel(currentModel, plane);
        name.textContent = label;
        const angle = ((Number(current[rotKey]) || 0) % 360 + 360) % 360;
        const h = current[flipHKey] === true;
        const v = current[flipVKey] === true;
        rot.title = `${window.Iro.t('module.slices.rotate')} ${label} 90\u00b0 (now ${angle}\u00b0)`;
        rot.setAttribute('aria-label', rot.title);
        flipH.title = `${window.Iro.t('module.slices.flipH')} ${label}`;
        flipH.setAttribute('aria-label', flipH.title);
        flipV.title = `${window.Iro.t('module.slices.flipV')} ${label}`;
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

      row.append(grip, box, name, rot, flipH, flipV);
      list.append(row);
      rows.push({ el: row, grip, label: name, plane, refresh });
    };

    for (let plane = 0; plane < 3; plane += 1) makeRow(plane);
    // Seat the rows in the stored order.
    for (const plane of normaliseOrder(api.get().sliceOrder)) {
      const row = rows.find((r) => r.plane === plane);
      if (row) list.append(row.el);
    }

    const refreshModelHint = () => {
      const limited = isLimited(store, currentModel);
      modelHint.classList.toggle('hidden', !limited);
      modelHint.textContent = limited ? window.Iro.t('module.slices.srgbHint') : '';
    };
    const refreshLabels = () => {
      for (const r of rows) r.refresh();
      refreshModelHint();
    };
    refreshLabels();

    // Reorder: pointer drag on the gripper (and ArrowUp/ArrowDown when focused).
    let dragging = null;
    const commitOrder = () => api.patch({ sliceOrder: displayOrder() }, { immediate: true });
    for (const r of rows) {
      const grip = r.grip;
      grip.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        grip.setPointerCapture(ev.pointerId);
        if (window.IroInputReset) window.IroInputReset.capture(grip, ev.pointerId);
        dragging = r.el;
        r.el.classList.add('dragging');
      });
      const move = (ev) => {
        if (!dragging) return;
        const others = [...list.children].filter((el) => el !== dragging);
        let before = null;
        for (const el of others) {
          const rect = el.getBoundingClientRect();
          if (ev.clientY < rect.top + rect.height / 2) { before = el; break; }
        }
        if (before) list.insertBefore(dragging, before);
        else list.append(dragging);
      };
      grip.addEventListener('pointermove', move);
      const end = () => {
        if (!dragging) return;
        dragging.classList.remove('dragging');
        dragging = null;
        if (window.IroInputReset) window.IroInputReset.releaseAll();
        commitOrder();
      };
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', end);
      grip.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
        ev.preventDefault();
        const sibling = ev.key === 'ArrowUp' ? r.el.previousElementSibling : r.el.nextElementSibling;
        if (!sibling) return;
        if (ev.key === 'ArrowUp') list.insertBefore(r.el, sibling);
        else list.insertBefore(sibling, r.el);
        commitOrder();
        grip.focus();
      });
    }

    addToggle('guideLines', window.Iro.t('module.slices.guide'));
    const guideHint = document.createElement('div');
    guideHint.className = 'pop-hint';
    guideHint.textContent = window.Iro.t('module.slices.guideLock');
    root.append(guideHint);

    const numbers = document.createElement('label');
    numbers.className = 'pop-row';
    const numbersBox = document.createElement('input');
    numbersBox.type = 'checkbox';
    numbersBox.checked = api.get().hideNumbers === true;
    const numbersLabel = document.createElement('span');
    numbersLabel.textContent = window.Iro.t('module.settings.hideValues');
    numbers.append(numbersBox, numbersLabel);
    numbersBox.addEventListener('change', () => api.patch({ hideNumbers: numbersBox.checked }));
    root.append(numbers);

    const orient = document.createElement('label');
    orient.className = 'pop-row';
    const orientName = document.createElement('span');
    orientName.textContent = window.Iro.t('module.settings.orientation');
    orient.append(orientName);
    window.IroModelOptions.menu(orient, {
      items: [['horizontal', 'module.settings.horizontal'], ['vertical', 'module.settings.vertical']]
        .map(([value, key]) => ({ value, label: window.Iro.t(key) })),
      value: api.get().orientation === 'vertical' ? 'vertical' : 'horizontal',
      onChange: (v) => api.patch({ orientation: v }),
    });
    root.append(orient);
  };

  reg.modules['color-slices'] = {
    id: 'color-slices',
    name: 'Color Slices',
    version: 5,
    defaults: {
      model: 'oklch', constantHue: true, constantLightness: true, constantChroma: true,
      guideLines: true, hideNumbers: false, orientation: 'vertical',
      sliceOrder: [0, 1, 2],
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
      const panels = SHOW_KEYS.filter((key) => settings[key] !== false).length || 1;
      return { width: 120, height: 34 + panels * 60 };
    },

    create(ctx) {
      const Color = window.Color;
      const store = ctx.color;
      const Input = window.IroInputReset;
      const SV = window.IroSliceView;
      const Raster = window.IroRasterPlane;
      const Contour = window.IroContour;
      const Cadence = window.IroRenderCadence;
      const identity = SV ? SV.composeView(0, false, false) : { rotate: 0, flipH: false, flipV: false };
      const panelViews = [identity, identity, identity];
      const viewFor = (p) => panelViews[p] || identity;
      const point = (p, u, v) => (SV ? SV.forward(viewFor(p), u, v) : { u, v });

      // Plot caches depend on the gamut *and* the profile identity, so a profile
      // switch cannot leave a stale silhouette behind (the key tag covers it).
      const plotCache = new Map();
      // The last-built map per panel. During a drag the maps of the *other*
      // panels are held (their fixed axes are changing); the dragged panel's map
      // is stable because its fixed axis is pinned.
      const lastOff = [null, null, null];
      // The lightness field of a map travels on the canvas itself (`__luma`), so the
      // guide always matches the image currently on screen, whatever its size or key.
      // Extracted by src/shared/contour.js (marching squares).
      // Interactive raster pacing: how long the last plane build took, and the
      // moment the next one may start (buildRasterPlot sets both).
      let lastRasterMs = 0;
      let holdUntil = 0;

      // The drag snapshot: the plane, its fixed axes and (with Shift) the frozen
      // light axis. Nothing in a drag re-reads these from the store.
      let dragAxes = null;
      let dragPanel = -1;
      let lockLight = null;
      const inputCleanups = [];

      const panels = document.createElement('div');
      panels.className = 'slice-panels';
      panels.dataset.orientation = 'vertical';
      ctx.el.append(panels);

      const panelSections = [null, null, null];
      const panelCanvases = [null, null, null];
      const makePanel = (plane) => {
        const section = document.createElement('section');
        section.className = 'panel';
        const canvas = document.createElement('canvas');
        canvas.className = 'plot';
        canvas.id = PANEL_IDS[plane];
        canvas.dataset.plot = PANEL_IDS[plane];
        section.append(canvas);
        panels.append(section);
        panelSections[plane] = section;
        panelCanvases[plane] = canvas;
      };
      makePanel(0);
      makePanel(1);
      makePanel(2);

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

      let modelId = Models.DEFAULT_ID;
      let sliceOrder = [0, 1, 2];
      const modelNow = () => {
        const chosen = Models.get(modelId);
        if (chosen && Models.inFamily(chosen, store.viewFamily || 'all')) return chosen;
        return Models.get(Models.defaultForFamily(store.viewFamily || 'all')) || Models.get(Models.DEFAULT_ID);
      };
      const axesNow = () => Models.axesFor(modelNow(), store);

      const applyLabels = () => {
        const model = modelNow();
        for (let p = 0; p < 3; p += 1) {
          panelSections[p].title = Models.planeLabel(model, p);
        }
        for (let i = 0; i < 3; i += 1) outLabels[i].textContent = model.axes[i].label;
      };

      const applyOrder = () => {
        for (let i = 0; i < 3; i += 1) {
          panelSections[sliceOrder[i]].style.order = String(i);
        }
      };

      let hideNumbers = false;
      let guideLines = true;
      let narrow = false;
      const updateFooter = () => footer.classList.toggle('hidden', hideNumbers || narrow);

      const sizeCanvas = (canvas, cap = 2.5, nativeOnly = false) => {
        // The backing store never drops below the idle resolution during a drag:
        // rebuilding one panel per frame is the throttle, not a 1× upscale.
        // An expensive model's interactive plane does render at native device pixels
        // (`nativeOnly`): 2× supersampling is four times the pixels, and that is what
        // stalled the pointer. Full supersampling returns on the trailing rebuild.
        const dpr = nativeOnly
          ? Math.max(1, Math.min(window.devicePixelRatio || 1, cap))
          : Math.min(Math.max(window.devicePixelRatio || 1, 2), cap);
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
      const buildPlot = (key, w, h, intervalsAt, colorAt, lumaAt) => {
        const cached = plotCache.get(key);
        if (cached && cached.width === w && cached.height === h) return cached;

        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        const img = c2d.createImageData(w, h);
        const data = img.data;
        const luma = new Float32Array(w * h).fill(NaN);

        const put = (i, r, g, b) => {
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
              put(i, r, g, b);
              luma[y * w + x] = lumaAt(x / (w - 1));
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
            put(i, r, g, b);
            luma[y * w + x] = lumaAt(x / (w - 1));
          }
        }

        c2d.putImageData(img, 0, 0);
        plotCache.set(key, off);
        off.__luma = luma;
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
        const luma = new Float32Array(w * h).fill(NaN);

        for (let y = 0; y < h; y++) {
          const L = 1 - y / (h - 1);
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const H = (x / (w - 1)) * 360;
            if (store.inGamut(L, C, H)) {
              const f = Color.fitToSrgb(L, C, H);
              data[i] = clamp255(f.r * 255);
              data[i + 1] = clamp255(f.g * 255);
              data[i + 2] = clamp255(f.b * 255);
              data[i + 3] = 255;
              luma[y * w + x] = L;
            } else {
              data[i + 3] = 0;
            }
          }
        }
        c2d.putImageData(img, 0, 0);
        plotCache.set(key, off);
        off.__luma = luma;
        return off;
      };

      const paint = (canvas, off, w, h, view) => {
        const c2d = canvas.getContext('2d');
        c2d.save();
        c2d.setTransform(1, 0, 0, 1, 0, 0);
        c2d.clearRect(0, 0, canvas.width, canvas.height);
        // The offscreen map is 1:1 with the canvas (the drag canvas is already
        // native 1× CSS), so there is no upscaled low-res map.
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

      // The guide actually on screen per panel, in normalized map (u, v) coordinates, so
      // a pointer near the line can be projected onto it and pick the line's own colour.
      const guideMap = [null, null, null];

      /** The iso-lightness guide: the contour of the map's own lightness field. */
      const drawGuide = (c2d, plane, w, h, model, axes, scale) => {
        guideMap[plane] = null;
        if (!guideLines || !Contour) return;
        const src = lastOff[plane];
        const luma = src && src.__luma;
        if (!luma) return;
        // The model's own lightness: CIELAB L*, HelmGen L, or OKLab L for the
        // sRGB-referenced spaces — the same value the lock holds and the footer prints.
        //
        // When the plane's *fixed* axis is the light axis, the map is keyed by that
        // light: trace the contour from the light the map was built for, not the live
        // one. Otherwise a paced/stale map is traced at a newer target and the guide
        // jumps and misses the pointer (the OKHSV HxS report). For planes whose light
        // is free the map is valid for every light, so the live target is right.
        const planes = Models.planesFor(model);
        const fixedIndex = planes[plane] ? planes[plane][2] : -1;
        const lightIndex = Models.lightAxis(model);
        const fixedAxes = (fixedIndex === lightIndex && src.__fixed) ? src.__fixed : axes;
        const target = lockLight != null ? lockLight : G.lightnessOf(model, fixedAxes);
        // The field belongs to the map, which may differ in size from the canvas (the
        // interactive native-pixel build, or a held map): index it with its own size,
        // or the contour is scrambled into many stacked lines. Every cell is sampled
        // (stride 1) and one-cell holes are bridged, because the guide is also the
        // path the user drags along and it must not arrive in pieces.
        const sw = Math.max(2, src.width);
        const sh = Math.max(2, src.height);
        const lines = Contour.isoLines(luma, sw, sh, target);
        if (!lines.length) return;
        guideMap[plane] = lines.map((pts) => pts.map(([x, y]) => [x / (sw - 1), y / (sh - 1)]));
        // Pixel -> the map's drawn transform, the same one paint() uses (v down).
        const wd = Math.max(1, w - 1);
        const hd = Math.max(1, h - 1);
        const segs = lines.map((pts) => pts.map(([x, y]) => {
          const s = point(plane, x / (sw - 1), y / (sh - 1));
          return [s.u * wd, s.v * hd];
        }));
        Overlay.guide(c2d, segs, { locked: lockLight !== null, scale });
      };

      /** Crosshair/pointer for one painted panel. */
      const drawOverlay = (c2d, plane, w, h, model, axes) => {
        const scale = w / Math.max(1, panelCanvases[plane].clientWidth);
        drawGuide(c2d, plane, w, h, model, axes, scale);
        const clamped = G.clampAxes(model, axes, store);
        const p = G.pointOf(model, plane, clamped.axes, store);
        const s = point(plane, p.u, 1 - p.v);
        const x = s.u * (w - 1), y = s.v * (h - 1);
        if (store.crosshair) Overlay.crosshair(c2d, w, h, x, y, { scale });
        Overlay.pointer(c2d, x, y, { clamped: clamped.clamped, scale });
      };

      // --- OKLCH: the analytic silhouette ------------------------------------

      const renderOklchPlots = (target = null) => {
        const axes = axesNow();
        const fixedFor = (p) => (store.dragging && p === dragPanel && dragAxes) ? dragAxes : axes;
        const want = (p, off) => target === null || target === p || !off;

        // Lightness x Chroma at the current hue.
        {
          const plane = 0;
          const section = panelSections[plane];
          const canvas = panelCanvases[plane];
          if (!section.classList.contains('hidden') && canvas.clientWidth >= 2 && canvas.clientHeight >= 2) {
            const { w: W, h: H } = sizeCanvas(canvas, 2.5);
            const rw = W, rh = H;
            const fixed = fixedFor(plane);
            const key = `lc:${store.plotKeyTag()}:${fixed[2].toFixed(3)}:${rw}x${rh}`;
            let off = lastOff[plane];
            if (want(plane, off)) {
              off = buildPlot(key, rw, rh,
                (xNorm) => store.chromaIntervals(clamp(xNorm, 0, 1), fixed[2]),
                (xNorm, c) => {
                  const f = Color.fitToSrgb(clamp(xNorm, 0, 1), c, fixed[2]);
                  return { r: clamp255(f.r * 255), g: clamp255(f.g * 255), b: clamp255(f.b * 255) };
                },
                (xNorm) => clamp(xNorm, 0, 1));
              lastOff[plane] = off;
            }
            const c2d = paint(canvas, off, W, H, viewFor(plane));
            drawOverlay(c2d, plane, W, H, modelNow(), axes);
          }
        }

        // Hue x Chroma at the current lightness.
        {
          const plane = 1;
          const section = panelSections[plane];
          const canvas = panelCanvases[plane];
          if (!section.classList.contains('hidden') && canvas.clientWidth >= 2 && canvas.clientHeight >= 2) {
            const { w: W, h: H } = sizeCanvas(canvas, 2.5);
            const rw = W, rh = H;
            const fixed = fixedFor(plane);
            const key = `hc:${store.plotKeyTag()}:${fixed[0].toFixed(3)}:${rw}x${rh}`;
            let off = lastOff[plane];
            if (want(plane, off)) {
              off = buildPlot(key, rw, rh,
                (xNorm) => store.chromaIntervals(fixed[0], xNorm * 360),
                (xNorm, c) => {
                  const f = Color.fitToSrgb(fixed[0], c, xNorm * 360);
                  return { r: clamp255(f.r * 255), g: clamp255(f.g * 255), b: clamp255(f.b * 255) };
                },
                () => fixed[0]);
              lastOff[plane] = off;
            }
            const c2d = paint(canvas, off, W, H, viewFor(plane));
            drawOverlay(c2d, plane, W, H, modelNow(), axes);
          }
        }

        // Hue x Lightness at the current chroma (the omitted slice).
        {
          const plane = 2;
          const section = panelSections[plane];
          const canvas = panelCanvases[plane];
          if (!section.classList.contains('hidden') && canvas.clientWidth >= 2 && canvas.clientHeight >= 2) {
            const { w: W, h: H } = sizeCanvas(canvas, 2.5);
            const rw = W, rh = H;
            const fixed = fixedFor(plane);
            const key = `hue:${store.plotKeyTag()}:${fixed[1].toFixed(3)}:${rw}x${rh}`;
            let off = lastOff[plane];
            if (want(plane, off)) {
              off = buildHuePlot(key, rw, rh, fixed[1]);
              lastOff[plane] = off;
            }
            const c2d = paint(canvas, off, W, H, viewFor(plane));
            drawOverlay(c2d, plane, W, H, modelNow(), axes);
          }
        }
      };

      // --- any other model: rasterise each plane against the working gamut ---

      // The plane rasteriser is shared and unit-tested against the old per-pixel
      // loop (src/shared/raster-plane.js). One conversion chain per pixel instead of
      // five is what keeps HelmGen usable.
      const workingGamutTest = () => (store.useWorkingGamut()
        ? (lab) => {
          const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
          return store.inGamut(lch.L, lch.C, lch.H);
        }
        : null);

      const buildRasterPlot = (key, w, h, plane, model, fixed) => {
        const cached = plotCache.get(key);
        if (cached && cached.width === w && cached.height === h) return cached;
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        const img = c2d.createImageData(w, h);
        const ranges = [0, 1, 2].map((i) => G.range(model, i, store));
        const luma = new Float32Array(w * h).fill(NaN);
        const started = performance.now();
        if (Raster && typeof Raster.renderPlane === 'function') {
          Raster.renderPlane({
            model, plane, fixed, ranges, width: w, height: h, out: img.data, luma,
            workingGamut: workingGamutTest(),
            // A dense model's map is total: out-of-gamut pixels are dimmed stand-ins,
            // never holes (the "white out of gamut" in OKHSV).
            fill: model.dense === true,
            // Inside the document but beyond the display: full opacity by default (the
            // nearest displayable colour), dimmed when the user asks to see the region.
            outAlpha: store.markOutOfDisplay ? 140 : 255,
          });
        }
        // The interactive budget must come from the interactive build only: the
        // trailing full-quality plane is ~4x the pixels, and measuring it marked
        // every model "expensive" and froze the maps for the whole next gesture.
        if (store.interactive) {
          lastRasterMs = performance.now() - started;
          holdUntil = performance.now() + Cadence.holdFor(lastRasterMs);
        } else {
          lastRasterMs = 0;
          holdUntil = 0;
        }
        c2d.putImageData(img, 0, 0);
        plotCache.set(key, off);
        off.__luma = luma;
        off.__fixed = fixed.slice();
        return off;
      };

      const renderGenericPlots = (target = null) => {
        const model = modelNow();
        const axes = axesNow();
        const planes = Models.planesFor(model);
        const want = (p, off) => target === null || target === p || !off;
        for (let p = 0; p < 3; p += 1) {
          const section = panelSections[p];
          if (section.classList.contains('hidden')) continue;
          const canvas = panelCanvases[p];
          if (canvas.clientWidth < 2 || canvas.clientHeight < 2) continue;
          const { w: W, h: H } = sizeCanvas(canvas, 2, store.interactive);
          const rw = W, rh = H;
          // The image depends only on the plane's fixed axis (plus the gamut,
          // model and size) — not on the selected colour. During a drag on this
          // panel the pinned snapshot keeps that axis stable; the other panels use
          // the live axes and are rebuilt (throttled) so they follow the drag.
          const fixed = (store.dragging && p === dragPanel && dragAxes) ? dragAxes : axes;
          const fi = planes[p][2];
          const key = `g${p}:${store.plotKeyTag()}:${model.id}:${rw}x${rh}:${fixed[fi].toFixed(5)}`;
          let off = lastOff[p];
          if (want(p, off)) {
            off = buildRasterPlot(key, rw, rh, p, model, fixed);
            lastOff[p] = off;
          }
          const c2d = paint(canvas, off, W, H, viewFor(p));
          drawOverlay(c2d, p, W, H, model, axes);
        }
      };

      let buildCursor = 0;
      const renderPlots = (force) => {
        // A local drag or a sibling palette's preview stream: both are a gesture in
        // flight, so one panel per frame keeps the pointer smooth while every slice
        // still follows. The trailing emit after the stream ends does the
        // full-quality pass (`force`/`interactive` false).
        if (!force && store.interactive) {
          // One panel per frame, round-robin, excluding the pinned active panel. The
          // budget comes from the interactive build (src/shared/render-cadence.js): a
          // plane that fits in a frame never waits, a heavy one is spaced out, and the
          // overlays are still repainted on every panel.
          const visible = [];
          for (let p = 0; p < 3; p += 1) {
            if (p === dragPanel) continue;
            if (!panelSections[p].classList.contains('hidden')) visible.push(p);
          }
          const pick = Cadence.pickPanel({ visible, cursor: buildCursor, now: performance.now(), holdUntil });
          if (pick.panel >= 0) buildCursor = pick.cursor;
          if (modelId === Models.DEFAULT_ID) renderOklchPlots(pick.panel);
          else renderGenericPlots(pick.panel);
          return;
        }
        if (modelId === Models.DEFAULT_ID) renderOklchPlots(null);
        else renderGenericPlots(null);
      };

      /** Trim the plot cache so it cannot grow without bound while dragging. */
      const prunePlotCache = () => {
        if (plotCache.size <= 8) return;
        const keys = [...plotCache.keys()];
        for (let i = 0; i < keys.length - 6; i++) {
          plotCache.delete(keys[i]);
        }
      };

      // --- interaction -------------------------------------------------------

      const metricsOf = (canvas) => {
        const r = canvas.getBoundingClientRect();
        return {
          left: r.left, top: r.top,
          clientLeft: canvas.clientLeft, clientTop: canvas.clientTop,
          clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight,
        };
      };

      /** Nearest lightness (at this chroma and hue) that is inside the gamut. */
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

      /** Nearest hue (at this lightness and chroma) that is inside the gamut. */
      const clampHToGamut = (L, C, H) => {
        if (store.inGamut(L, C, H)) return H;
        let best = H;
        let bestD = Infinity;
        for (let h = 0; h < 360; h += 0.5) {
          if (!store.inGamut(L, C, h)) continue;
          const d = Math.abs(((h - H + 540) % 360) - 180);
          if (d < bestD) { bestD = d; best = h; }
        }
        return best;
      };

      const lightIndex = (model) => Models.lightAxis(model);

      const attach = (canvas, plane) => {
        let active = false;
        let startAxes = null;

        const pick = (ev) => {
          const met = metricsOf(canvas);
          const at = G.contentPoint(met, ev.clientX, ev.clientY);
          const p = SV ? SV.inverse(viewFor(plane), at.x, at.y) : { u: at.x, v: at.y };
          const model = modelNow();
          if (!startAxes) startAxes = axesNow();
          const fixed = startAxes;
          const li = lightIndex(model);
          // A locked (Shift) drag projects the pointer onto the drawn guide: every point
          // of the line has the guide's lightness, so the line *is* the set of valid picks.
          // Without the lock the pick is the raw pointer position — an always-on magnet
          // made the pointer stick to the guide near it, which reads as a soft-lock.
          const snap = (lockLight !== null && guideMap[plane])
            ? Contour.nearestOnLines(guideMap[plane], p.u, p.v, 8, 8)
            : null;
          const u = snap ? snap.u : p.u;
          const v = snap ? snap.v : p.v;

          if (model.id === Models.DEFAULT_ID) {
            const cmax = store.cmax();
            if (plane === 0) {
              const L = lockLight !== null ? clamp01(lockLight) : u;
              store.setLCH({ L, C: (1 - v) * cmax, H: fixed[2] }, { notify: 'live', snap: true });
            } else if (plane === 1) {
              const C = (1 - v) * cmax;
              store.setLCH({ L: fixed[0], C, H: C < 1e-6 ? fixed[2] : u * 360 }, { notify: 'live', snap: true });
            } else {
              const C = fixed[1];
              const H = C < 1e-6 ? fixed[2] : u * 360;
              if (lockLight !== null) {
                const L = clamp01(lockLight);
                store.setLCH({ L, C, H: clampHToGamut(L, C, H) }, { notify: 'live', snap: true });
              } else {
                store.setLCH({ L: clampLToGamut(1 - v, C, H), C, H }, { notify: 'live' });
              }
            }
            return;
          }

          let axes = G.pickAxes(model, plane, u, 1 - v, fixed, store);
          if (lockLight !== null && !snap) {
            // A guide point already has the locked lightness (the line is drawn for it,
            // to within a pixel), so the solver's rejection must not drop the pick.
            const held = G.applyLightness(model, plane, axes, lockLight, store);
            if (!G.lightnessReached(model, held, lockLight)) return;
            axes = held;
          }
          store.setLab(model.toLab(axes), { notify: 'live', snap: true });
        };

        canvas.addEventListener('pointerdown', (ev) => {
          active = true;
          store.dragging = true;
          dragPanel = plane;
          startAxes = axesNow();
          dragAxes = startAxes;
          lockLight = ev.shiftKey ? G.lightnessOf(modelNow(), startAxes) : null;
          if (Input) Input.capture(canvas, ev.pointerId);
          pick(ev);
          ev.preventDefault();
        });
        canvas.addEventListener('pointermove', (ev) => {
          if (!active) return;
          // Shift may be pressed mid-drag: freeze canonical lightness from that moment.
          if (ev.shiftKey && lockLight === null) lockLight = G.lightnessOf(modelNow(), axesNow());
          else if (!ev.shiftKey && lockLight !== null) lockLight = null;
          pick(ev);
        });
        const end = () => {
          if (!active) return;
          active = false;
          store.dragging = false;
          dragPanel = -1;
          dragAxes = null;
          startAxes = null;
          lockLight = null;
          if (Input) Input.releaseAll();
          store.setLCH(store.lch(), { notify: 'commit' });
          renderPlots(true);
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        const onReset = () => {
          if (!active) return;
          active = false;
          store.dragging = false;
          dragPanel = -1;
          dragAxes = null;
          startAxes = null;
          lockLight = null;
          if (Input) Input.releaseAll();
          renderPlots(true);
        };
        inputCleanups.push(() => window.removeEventListener('iro:input-reset', onReset));
        window.addEventListener('iro:input-reset', onReset);
      };

      attach(panelCanvases[0], 0);
      attach(panelCanvases[1], 1);
      attach(panelCanvases[2], 2);

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
        const model = modelNow();
        const axes = Models.axesFor(model, store);
        for (let i = 0; i < 3; i++) {
          const def = model.axes[i];
          outNums[i].textContent = Models.formatAxis(def, axes[i]);
        }
        schedulePlots();
      };

      const unsubscribe = store.subscribe(render);
      applyLabels();
      applyOrder();
      render();

      return {
        onResize({ width }) {
          narrow = width < 150;
          updateFooter();
          renderPlots(true);
        },
        onSettings(settings) {
          const nextModel = Models.has(settings.model) ? settings.model : Models.DEFAULT_ID;
          if (nextModel !== modelId) {
            modelId = nextModel;
            plotCache.clear();
            lastOff[0] = lastOff[1] = lastOff[2] = null;
            buildCursor = 0;
            lockLight = null;
            applyLabels();
          }
          if (settings.sliceOrder !== undefined) {
            sliceOrder = normaliseOrder(settings.sliceOrder);
            applyOrder();
          }
          panelSections[0].classList.toggle('hidden', settings.constantHue === false);
          panelSections[1].classList.toggle('hidden', settings.constantLightness === false);
          panelSections[2].classList.toggle('hidden', settings.constantChroma === false);
          hideNumbers = settings.hideNumbers === true;
          guideLines = settings.guideLines !== false;
          panels.dataset.orientation = settings.orientation === 'horizontal' ? 'horizontal' : 'vertical';
          panelViews[0] = SV ? SV.composeView(settings.slice1Rotate, settings.slice1FlipH, settings.slice1FlipV) : identity;
          panelViews[1] = SV ? SV.composeView(settings.slice2Rotate, settings.slice2FlipH, settings.slice2FlipV) : identity;
          panelViews[2] = SV ? SV.composeView(settings.slice3Rotate, settings.slice3FlipH, settings.slice3FlipV) : identity;
          updateFooter();
          renderPlots(true);
        },
        settings(root) { settingsUI(ctx.settings, root, ctx.color); },
        destroy() {
          for (const off of inputCleanups) off();
          unsubscribe();
          if (rafId) cancelAnimationFrame(rafId);
        },
      };
    },
  };
})();

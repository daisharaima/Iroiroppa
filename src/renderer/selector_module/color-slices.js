'use strict';

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};
  const Models = window.IroColorModels;
  const G = window.IroSliceGeometry;
  const Overlay = window.IroPickerOverlay;

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp01 = (x) => clamp(x, 0, 1);

  const SHOW_KEYS = ['constantHue', 'constantLightness', 'constantChroma'];
  const PANEL_IDS = ['plot-lc', 'plot-hc', 'plot-hue'];
  const SRGB_LIMITED = ['okhsv', 'okhsl'];
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
    const rows = [];

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
        rot.setAttribute('aria-label', `${window.Iro.t('module.slices.rotate')} ${label} 90\u00b0 (now ${angle}\u00b0)`);
        flipH.setAttribute('aria-label', `${window.Iro.t('module.slices.flipH')} ${label}`);
        flipV.setAttribute('aria-label', `${window.Iro.t('module.slices.flipV')} ${label}`);
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
    addToggle('crosshair', window.Iro.t('module.slices.crosshair'));
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

    lens: true,
    name: 'Color Slices',
    version: 5,
    defaults: {
      model: 'oklch', constantHue: true, constantLightness: true, constantChroma: true,
      guideLines: true, crosshair: true, hideNumbers: false, orientation: 'vertical',
      sliceOrder: [0, 1, 2],
      slice1Rotate: 0, slice1FlipH: false, slice1FlipV: false,
      slice2Rotate: 0, slice2FlipH: false, slice2FlipV: false,
      slice3Rotate: 0, slice3FlipH: false, slice3FlipV: false,
    },
    migrate(stored) {

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

      const Plane = window.IroSlicePlane;
      const identity = SV ? SV.composeView(0, false, false) : { rotate: 0, flipH: false, flipV: false };
      const panelViews = [identity, identity, identity];
      const viewFor = (p) => panelViews[p] || identity;
      const point = (p, u, v) => (SV ? SV.forward(viewFor(p), u, v) : { u, v });

      const plotCache = new Map();

      const LensAccess = window.IroLensAccess;
      let lensKey = null;
      let lensNow = null;
      const syncLens = () => {
        if (!LensAccess) return;
        const settings = ctx.settings.get();
        const next = LensAccess.key(store, settings);
        if (next === lensKey) return;
        lensKey = next;
        lensNow = LensAccess.build(store, settings);
        plotCache.clear();
      };
      syncLens();

      /**
       * What the lens records for a colour the pointer is on. The store keeps the pointer's
       * own colour for geometry (pointer, guide, the plane's fixed axes) and only *sends*
       * this one, so a band can never yank the picker's channels around (the shifting-hue
       * and shifting-L reports).
       */
      const lensRecorded = (lab) => (lensNow
        ? lensNow.applyLab(lab, Color.rgbToOklab, Color.oklabToRgb)
        : null);

      const lastOff = [null, null, null];

      let lastRasterMs = 0;
      let holdUntil = 0;

      let dragAxes = null;
      let dragPanel = -1;
      let lockLight = null;
      const inputCleanups = [];

      const lastPointer = [null, null, null];

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
      let crosshair = true;
      let narrow = false;
      const updateFooter = () => footer.classList.toggle('hidden', hideNumbers || narrow);

      const sizeCanvas = (canvas, cap = 2.5, nativeOnly = false) => {

        const base = window.devicePixelRatio || 1;
        const want = nativeOnly ? Math.max(1, Math.min(base, cap)) : Math.min(Math.max(base, 2), cap);
        const dpr = window.IroCanvasSize
          ? window.IroCanvasSize.backingScale(canvas.clientWidth, canvas.clientHeight, {
            want,
            budget: nativeOnly ? window.IroCanvasSize.LIVE_BUDGET : window.IroCanvasSize.IDLE_BUDGET,
          })
          : want;
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

      const chunkedInFlight = new Set();

      if (typeof document !== 'undefined' && !document.__plotVisibilityHooked) {
        document.__plotVisibilityHooked = true;
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) return;
          chunkedInFlight.clear();
          for (let i = 0; i < 3; i += 1) plotGeneration[i] += 1;
        });
      }

      const plotGeneration = [0, 0, 0];

      const COSTLY_PLANE_PX = 40000;

      const round1 = (x) => Math.round(x * 10) / 10;

      const chunkStats = (window.__plotDbg = window.__plotDbg || { chunked: 0, sync: 0, panels: 0, t: {} });
      if (typeof chunkStats.chunked !== 'number') chunkStats.chunked = 0;
      if (typeof chunkStats.sync !== 'number') chunkStats.sync = 0;
      if (typeof chunkStats.panels !== 'number') chunkStats.panels = 0;
      if (!chunkStats.t || typeof chunkStats.t !== 'object') chunkStats.t = {};
      if (!Array.isArray(chunkStats.p)) chunkStats.p = [{ n: 0, ms: 0, maxMs: 0 }, { n: 0, ms: 0, maxMs: 0 }, { n: 0, ms: 0, maxMs: 0 }];

      /** Accumulate per-section time so a long task can be attributed to a call. */
      const timed = (name, fn) => {
        const start = performance.now();
        const result = fn();
        const spent = performance.now() - start;
        chunkStats.t[name] = Math.round(((chunkStats.t[name] || 0) + spent) * 10) / 10;
        if (spent > (chunkStats.t[name + 'Max'] || 0)) chunkStats.t[name + 'Max'] = Math.round(spent * 10) / 10;
        return result;
      };

      /**
       * Paint one panel: keep the last image, schedule a chunked build when the key
       * changed, and repaint when it lands. Never blocks for a whole plane.
       */
      const panelPlot = (plane, key, build, canvas, W, H) => {
        let off = lastOff[plane];
        if (!off || off.__key !== key) {
          if ((store.interactive || (W * H > COSTLY_PLANE_PX && lastOff[plane])) && !plotCache.has(key)) {
            if (!chunkedInFlight.has(key)) {
              chunkedInFlight.add(key);
              chunkStats.chunked += 1;
              const generation = ++plotGeneration[plane];
              const isStale = () => generation !== plotGeneration[plane]
                || canvas.width !== W || canvas.height !== H;
              build((built) => {
                chunkedInFlight.delete(key);
                if (!built) {

                  chunkStats.t.aborted = (chunkStats.t.aborted || 0) + 1;
                  return;
                }
                if (generation !== plotGeneration[plane]) return;
                built.__key = key;
                lastOff[plane] = built;
                const next2d = paint(canvas, built, W, H, viewFor(plane));
                drawOverlay(next2d, plane, W, H, modelNow(), axesNow());
              }, isStale);
            }
          } else {
            chunkStats.sync += 1;
            off = timed('build', () => build());
            off.__key = key;
            lastOff[plane] = off;
          }
        }
        if (!off) return;
        chunkStats.panels += 1;
        const c2d = timed('paint', () => paint(canvas, off, W, H, viewFor(plane)));
        timed('overlay', () => drawOverlay(c2d, plane, W, H, modelNow(), axesNow()));
      };

      const CHUNK_BUDGET_MS = 4;
      const CHUNK_BUDGET_IDLE_MS = 14;

      const chunkBudget = () => (plotChunks() === 1 ? CHUNK_BUDGET_IDLE_MS : CHUNK_BUDGET_MS);

      const plotChunks = () => (store.interactive ? 1 : PLOT_CHUNKS);

      const PLOT_CHUNKS = 3;

      const Chunks = (typeof IroPlotChunks !== 'undefined') ? IroPlotChunks : { size: (h, c) => Math.max(1, Math.ceil(h / c)) };

      /**
       * Build one analytic plane — synchronously for the cache-only path (the first
       * paint), or across frames with `onDone`.
       *
       * The per-pixel maths lives in src/shared/slice-plane.js: it hoists the plane's
       * constants and gamma-encodes through the raster plane's LUT, which is ~3-4 ms for
       * a panel-sized plane instead of 7-18 ms. That is what lets both sibling maps
       * rebuild in the same frame as the drag instead of stepping one per frame.
       */
      const buildPlot = (plane, key, spec, onDone, isStale) => {
        const cached = plotCache.get(key);
        if (cached && cached.width === spec.width && cached.height === spec.height) {
          if (onDone) onDone(cached);
          return cached;
        }

        const w = spec.width;
        const h = spec.height;
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        const img = c2d.createImageData(w, h);
        const data = img.data;
        const luma = new Float32Array(w * h).fill(NaN);

        const prepStart = performance.now();
        const prep = Plane.prepare({ ...spec, lens: lensNow });
        const prepMs = performance.now() - prepStart;

        if (!onDone) {
          Plane.fillRows(prep, data, luma, 0, h);
          Plane.paintFins(prep, data, luma);
          c2d.putImageData(img, 0, 0);
          plotCache.set(key, off);
          off.__luma = luma;
          return off;
        }

        const rowsPerChunk = Chunks.size(h, plotChunks());
        let row = 0;
        let spent = prepMs;
        const step = () => {

          if (isStale && isStale()) { onDone(null); return; }
          const stepStart = performance.now();
          const startRow = row;

          do {
            const end = Math.min(h, row + rowsPerChunk);
            Plane.fillRows(prep, data, luma, row, end);
            row = end;
          } while (row < h && performance.now() - stepStart < chunkBudget());

          c2d.putImageData(img, 0, 0, 0, startRow, w, row - startRow);
          const chunkMs = performance.now() - stepStart;
          spent += chunkMs;
          chunkStats.t.step = round1((chunkStats.t.step || 0) + chunkMs);
          chunkStats.t.stepMax = Math.max(chunkStats.t.stepMax || 0, round1(chunkMs));
          if (row < h) {
            requestAnimationFrame(step);
            return;
          }

          Plane.paintFins(prep, data, luma);
          c2d.putImageData(img, 0, 0);
          plotCache.set(key, off);
          off.__luma = luma;

          const measured = round1(spent);
          if (store.interactive) planeMs[plane] = measured;
          const stats = chunkStats.p[plane];
          stats.n += 1;
          stats.ms = round1(stats.ms + measured);
          stats.maxMs = Math.max(stats.maxMs, measured);
          onDone(off);
        };
        requestAnimationFrame(step);
        return off;
      };

      const paint = (canvas, off, w, h, view) => {
        const c2d = canvas.getContext('2d');
        c2d.save();
        c2d.setTransform(1, 0, 0, 1, 0, 0);
        c2d.clearRect(0, 0, canvas.width, canvas.height);

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

      const guideMap = [null, null, null];

      /** The iso-lightness guide: the contour of the map's own lightness field. */
      const drawGuide = (c2d, plane, w, h, model, axes, scale) => {
        guideMap[plane] = null;
        if (!guideLines || !Contour) return;
        const src = lastOff[plane];
        const luma = src && src.__luma;
        if (!luma) return;

        const planes = Models.planesFor(model);
        const fixedIndex = planes[plane] ? planes[plane][2] : -1;
        const lightIndex = Models.lightAxis(model);
        const mapLight = fixedIndex === lightIndex && src.__fixed && !store.interactive;
        const fixedAxes = mapLight ? src.__fixed : axes;
        const target = lockLight != null ? lockLight : G.lightnessOf(model, fixedAxes);

        const sw = Math.max(2, src.width);
        const sh = Math.max(2, src.height);

        const lines = Contour.isoLines(luma, sw, sh, target, { stride: 2 });
        if (!lines.length) return;

        const kept = lines.filter((pts) => {
          if (pts.length < 3) return false;
          let len = 0;
          for (let i = 1; i < pts.length; i += 1) {
            len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          }

          return len >= 12;
        });
        if (!kept.length || kept.length > 24) return;
        guideMap[plane] = kept.map((pts) => pts.map(([x, y]) => [x / (sw - 1), y / (sh - 1)]));

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
        if (crosshair) Overlay.crosshair(c2d, w, h, x, y, { scale });
        Overlay.pointer(c2d, x, y, { clamped: clamped.clamped, scale });
      };

      /**
       * The three analytic OKLCH planes.
       *
       * Every visible panel is painted on every pass — its cached map, its guide and its
       * pointer. `allowed` is the set of panels that may *rebuild* on this pass: during a
       * gesture that is every panel whose map is stale, because an analytic plane is
       * ~3-4 ms (src/shared/slice-plane.js) and two of them fit one frame. A panel that
       * gets no turn keeps its last map and still moves its pointer and guide, so nothing
       * freezes.
       */
      const renderOklchPlots = (allowed = null) => {
        const axes = axesNow();
        const model = modelNow();
        const cmax = store.cmax();
        const fixedFor = (p) => (store.dragging && p === dragPanel && dragAxes) ? dragAxes : axes;
        const want = (p, off) => allowed === null || allowed.has(p) || !off;

        {
          const plane = 0;
          const section = panelSections[plane];
          const canvas = panelCanvases[plane];
          if (!section.classList.contains('hidden') && canvas.clientWidth >= 2 && canvas.clientHeight >= 2) {
            const { w: W, h: H } = sizeCanvas(canvas, 2.5);
            const fixed = fixedFor(plane);
            const key = `lc:${store.plotKeyTag()}:${lensKey}:${fixed[2].toFixed(3)}:${W}x${H}`;
            if (want(plane, lastOff[plane])) {
              const spec = {
                kind: 'lc', width: W, height: H, cmax, fixed,
                intervalsAt: (u) => store.chromaIntervals(clamp(u, 0, 1), fixed[2]),
              };
              panelPlot(plane, key, (done, isStale) => buildPlot(plane, key, spec, done, isStale), canvas, W, H);
            } else if (lastOff[plane]) {
              const c2d = paint(canvas, lastOff[plane], W, H, viewFor(plane));
              drawOverlay(c2d, plane, W, H, model, axes);
            }
          }
        }

        {
          const plane = 1;
          const section = panelSections[plane];
          const canvas = panelCanvases[plane];
          if (!section.classList.contains('hidden') && canvas.clientWidth >= 2 && canvas.clientHeight >= 2) {
            const { w: W, h: H } = sizeCanvas(canvas, 2.5);
            const fixed = fixedFor(plane);
            const key = `hc:${store.plotKeyTag()}:${lensKey}:${fixed[0].toFixed(3)}:${W}x${H}`;
            if (want(plane, lastOff[plane])) {
              const spec = {
                kind: 'hc', width: W, height: H, cmax, fixed,
                intervalsAt: (u) => store.chromaIntervals(fixed[0], u * 360),
              };
              panelPlot(plane, key, (done, isStale) => buildPlot(plane, key, spec, done, isStale), canvas, W, H);
            } else if (lastOff[plane]) {
              const c2d = paint(canvas, lastOff[plane], W, H, viewFor(plane));
              drawOverlay(c2d, plane, W, H, model, axes);
            }
          }
        }

        {
          const plane = 2;
          const section = panelSections[plane];
          const canvas = panelCanvases[plane];
          if (!section.classList.contains('hidden') && canvas.clientWidth >= 2 && canvas.clientHeight >= 2) {
            const { w: W, h: H } = sizeCanvas(canvas, 2.5);
            const fixed = fixedFor(plane);
            const key = `hue:${store.plotKeyTag()}:${lensKey}:${fixed[1].toFixed(3)}:${W}x${H}`;
            if (want(plane, lastOff[plane])) {
              const spec = {
                kind: 'hue', width: W, height: H, cmax, fixed,

                inDocument: store.useWorkingGamut() ? (L, C, Hh) => store.inGamut(L, C, Hh) : null,
              };
              panelPlot(plane, key, (done, isStale) => buildPlot(plane, key, spec, done, isStale), canvas, W, H);
            } else if (lastOff[plane]) {
              const c2d = paint(canvas, lastOff[plane], W, H, viewFor(plane));
              drawOverlay(c2d, plane, W, H, model, axes);
            }
          }
        }
      };

      const workingGamutTest = () => (store.useWorkingGamut()
        ? (lab) => {
          const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
          return store.inGamut(lch.L, lch.C, lch.H);
        }
        : null);

      const PlaneWorker = window.IroPlaneWorker;
      const pendingKeys = [null, null, null];

      /** Turn a worker reply into the same offscreen canvas the synchronous path makes. */
      const imageFromResult = (result, w, h, fixed) => {
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        const img = c2d.createImageData(w, h);
        img.data.set(result.data);
        c2d.putImageData(img, 0, 0);
        off.__luma = result.luma;
        off.__fixed = fixed.slice();
        return off;
      };

      const buildRasterPlot = (key, w, h, plane, model, fixed, gamutTest) => {
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
            workingGamut: gamutTest || workingGamutTest(),
            lens: lensNow,

            fill: model.dense === true,
            fillAlpha: 255,

            outAlpha: store.markOutOfDisplay ? 140 : 255,
          });
        }

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

          const fixed = (store.dragging && p === dragPanel && dragAxes) ? dragAxes : axes;
          const fi = planes[p][2];
          const key = `g${p}:${store.plotKeyTag()}:${lensKey}:${model.id}:${rw}x${rh}:${fixed[fi].toFixed(5)}`;
          let off = lastOff[p];
          const gamutTest = workingGamutTest();

          const dbg = (window.__planeDbg = window.__planeDbg || { sync: 0, worker: 0, cache: 0, gamut: 0 });
          if (gamutTest) dbg.gamut += 1;
          if (want(p, off)) {
            const mayUseWorker = PlaneWorker && PlaneWorker.available() && !gamutTest && !lensNow;
            if (mayUseWorker) {

              if (pendingKeys[p] !== key) {
                pendingKeys[p] = key;
                PlaneWorker.render({
                  modelId: model.id,
                  plane: p,
                  fixed: fixed.slice(),
                  ranges: [0, 1, 2].map((i) => G.range(model, i, store)),
                  width: rw,
                  height: rh,
                  fill: model.dense === true,
                  fillAlpha: 255,
                  outAlpha: store.markOutOfDisplay ? 140 : 255,
                }, key).then((result) => {
                  if (!result || pendingKeys[p] !== key) return;
                  pendingKeys[p] = null;
                  const built = imageFromResult(result, rw, rh, fixed);
                  plotCache.set(key, built);
                  lastOff[p] = built;
                  const next2d = paint(canvas, built, W, H, viewFor(p));
                  drawOverlay(next2d, p, W, H, modelNow(), axesNow());
                });
              }

              dbg.worker += 1;
              if (!off) continue;
            } else {
              dbg.sync += 1;
              off = buildRasterPlot(key, rw, rh, p, model, fixed, gamutTest);
              lastOff[p] = off;
            }
          }
          dbg.cache += 1;
          const c2d = paint(canvas, off, W, H, viewFor(p));
          drawOverlay(c2d, p, W, H, model, axes);
        }
      };

      let buildCursor = 0;

      const planeMs = [0, 0, 0];

      const FRAME_BUILD_BUDGET_MS = 11;

      const renderPlots = (force) => {

        if (!force && store.interactive) {
          const visible = [];
          for (let p = 0; p < 3; p += 1) {
            if (p === dragPanel) continue;
            if (!panelSections[p].classList.contains('hidden')) visible.push(p);
          }
          if (modelId === Models.DEFAULT_ID) {

            const pick = Cadence.choosePanels({
              visible, cursor: buildCursor, costs: planeMs,
              budget: FRAME_BUILD_BUDGET_MS, now: performance.now(),
            });
            buildCursor = pick.cursor;
            renderOklchPlots(new Set(pick.panels));
          } else {

            const pick = Cadence.pickPanel({ visible, cursor: buildCursor, now: performance.now(), holdUntil });
            if (pick.panel >= 0) buildCursor = pick.cursor;
            renderGenericPlots(pick.panel);
          }
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

          const snap = (lockLight !== null && guideMap[plane])
            ? Contour.nearestOnLines(guideMap[plane], p.u, p.v, 8, 8)
            : null;
          const u = snap ? snap.u : p.u;
          const v = snap ? snap.v : p.v;
          lastPointer[plane] = { u, v };

          if (model.id === Models.DEFAULT_ID) {
            const cmax = store.cmax();
            const put = (lch, notify) => store.setLCH(lch, {
              notify,
              snap: true,
              recorded: lensRecorded(Color.oklchToOklab(lch.L, lch.C, lch.H)),
            });
            if (plane === 0) {
              const L = lockLight !== null ? clamp01(lockLight) : u;
              put({ L, C: (1 - v) * cmax, H: fixed[2] }, 'live');
            } else if (plane === 1) {
              const C = (1 - v) * cmax;
              put({ L: fixed[0], C, H: C < 1e-6 ? fixed[2] : u * 360 }, 'live');
            } else {
              const C = fixed[1];
              const H = C < 1e-6 ? fixed[2] : u * 360;
              if (lockLight !== null) {
                const L = clamp01(lockLight);
                put({ L, C, H: clampHToGamut(L, C, H) }, 'live');
              } else {
                store.setLCH({ L: clampLToGamut(1 - v, C, H), C, H },
                  { notify: 'live', recorded: lensRecorded(Color.oklchToOklab(clampLToGamut(1 - v, C, H), C, H)) });
              }
            }
            return;
          }

          let axes = G.pickAxes(model, plane, u, 1 - v, fixed, store);
          if (lockLight !== null && !snap) {

            const held = G.applyLightness(model, plane, axes, lockLight, store);
            if (!G.lightnessReached(model, held, lockLight)) return;
            axes = held;
          }
          const got = model.toLab(axes);
          store.setLab(got, { notify: 'live', snap: true, recorded: lensRecorded(got) });
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
          store.recommit();
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

          planeMs[0] = planeMs[1] = planeMs[2] = 0;
          renderPlots(true);
        },
        onSettings(settings) {
          syncLens();
          const nextModel = Models.has(settings.model) ? settings.model : Models.DEFAULT_ID;
          if (nextModel !== modelId) {
            modelId = nextModel;
            plotCache.clear();
            lastOff[0] = lastOff[1] = lastOff[2] = null;
            buildCursor = 0;
            planeMs[0] = planeMs[1] = planeMs[2] = 0;
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
          crosshair = settings.crosshair !== false;
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

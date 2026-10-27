'use strict';

// Color Disc — the hue x chroma plane at the current lightness, drawn on a circle.
//
// The disc's radius is the model's own saturation axis:
//   * Okhsv / Okhsl: s, which is relative to the cusp, so every hue reaches the rim
//     and the disc is a true circle (it is the sRGB gamut by definition).
//   * OKLCH / OKLab: absolute chroma, so the rim is the widest hue at this lightness
//     and the document's gamut is the lobed shape inside it — a round disc would
//     have to lie about chroma magnitude, so it is not drawn round.
// The third axis (L or V) is a slider under the disc; the disc stays a silhouette
// (out of gamut is transparent), like Color Slices.

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};
  const Models = window.IroColorModels;
  const G = window.IroSliceGeometry;

  // The disc draws hue by angle and chroma by radius, i.e. the *polar* form of a space.
  // A rectangular model and its LCH twin therefore draw the same picture, so the list
  // keeps one entry per space — the a/b forms, with the LCH twins resolved to them.
  const DISC_MODELS = ['oklab', 'okhsv', 'okhsl', 'cielab', 'helmgen'];
  const MODEL_TWIN = { oklch: 'oklab', cielch: 'cielab', helmgenlch: 'helmgen' };

  /** The model this module can actually draw, given a saved id (LCH twins mapped). */
  const discModel = (saved, available) => {
    const twin = MODEL_TWIN[saved] || saved;
    if (available.some((m) => m.id === twin)) return twin;
    return available.length ? available[0].id : 'okhsv';
  };

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp255 = (x) => clamp(Math.round(x), 0, 255);
  const CHEV_UP = '<svg viewBox="0 0 10 10"><path d="M2 6.5 5 3.5l3 3"/></svg>';
  const CHEV_DOWN = '<svg viewBox="0 0 10 10"><path d="M2 3.5 5 6.5l3-3"/></svg>';
  // The Disc's held axis is a horizontal slider row, so its nudge arrows step left and
  // right (the arrows follow the slider, not the reading direction of the number).
  const CHEV_LEFT = '<svg viewBox="0 0 10 10"><path d="M6.5 2 3.5 5l3 3"/></svg>';
  const CHEV_RIGHT = '<svg viewBox="0 0 10 10"><path d="M3.5 2 6.5 5l-3 3"/></svg>';

  /** The index of the axis the disc holds: L for OKLCH/OKLab, V/L for Okhsv/Okhsl. */
  const lightAxis = (model) => Models.lightAxis(model);

  const settingsUI = (api, root, store) => {
    const row = document.createElement('label');
    row.className = 'pop-row';
    const name = document.createElement('span');
    name.textContent = window.Iro.t('module.settings.model');
    const available = Models.listForFamily(store.viewFamily || 'all')
      .filter((m) => DISC_MODELS.includes(m.id));
    row.append(name);
    window.IroModelOptions.menu(row, {
      groups: window.IroModelOptions.groups(available),
      value: discModel(api.get().model, available),
      onChange: (id) => api.patch({ model: id }),
    });
    root.append(row);

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

    // The disc is painted whole, so the part of it the document cannot hold is drawn as a
    // dimmed stand-in (the pale section over a light theme). This switches that off: the
    // region is then painted clipped, part of the disc, with no pale band.
    const outRow = document.createElement('label');
    outRow.className = 'pop-row';
    const outBox = document.createElement('input');
    outBox.type = 'checkbox';
    outBox.checked = api.get().showOutOfGamut !== false;
    const outLabel = document.createElement('span');
    outLabel.textContent = window.Iro.t('module.disc.outOfGamut');
    outRow.append(outBox, outLabel);
    outBox.addEventListener('change', () => api.patch({ showOutOfGamut: outBox.checked }));
    root.append(outRow);
    const hint = document.createElement('div');
    hint.className = 'pop-hint';
    hint.textContent = window.Iro.t('module.slices.guideLock');
    root.append(hint);
  };

  reg.modules['color-disc'] = {
    id: 'color-disc',
    name: 'Color Disc',
    version: 1,
    // Content-sized: a circle plus one slider row, so a column share only leaves an
    // empty band under the disc. The canvas width (the palette width) sets its size.
    autoHeight: true,
    defaults: { model: 'okhsv', hideNumbers: false, guideLines: true, showOutOfGamut: true },
    settingsUI,
    minSize() { return { width: 140, height: 214 }; },

    create(ctx) {
      const Color = window.Color;
      const store = ctx.color;
      const Input = window.IroInputReset;
      const AVAILABLE = Models.listForFamily(store.viewFamily || 'all')
        .filter((m) => DISC_MODELS.includes(m.id));
      let modelId = discModel(ctx.settings.get().model, AVAILABLE);
      let hideNumbers = ctx.settings.get().hideNumbers === true;
      let guideLines = ctx.settings.get().guideLines !== false;
      let showOutOfGamut = ctx.settings.get().showOutOfGamut !== false;
      let resetCleanup = null;

      const body = document.createElement('div');
      body.className = 'disc-body';
      const canvas = document.createElement('canvas');
      canvas.className = 'disc-plot';
      body.append(canvas);
      ctx.el.append(body);

      // The held axis: a Slider-style row (gradient track, value, steppers).
      const sliders = document.createElement('section');
      sliders.className = 'sliders disc-sliders';
      // Horizontal row: the steppers sit side by side (CSS) with left/right chevrons.
      sliders.dataset.orientation = 'horizontal';
      const row = document.createElement('div');
      row.className = 'slider-row';
      const label = document.createElement('span');
      label.className = 'slider-label';
      const rng = document.createElement('input');
      rng.className = 'rng';
      rng.type = 'range';
      rng.step = 'any';
      const field = document.createElement('div');
      field.className = 'slider-field';
      const box = document.createElement('input');
      box.className = 'slider-value';
      box.type = 'text';
      box.spellcheck = false;
      const steppers = document.createElement('div');
      steppers.className = 'slider-steppers';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'slider-step';
      up.tabIndex = -1;
      up.setAttribute('aria-label', 'Increase');
      up.innerHTML = CHEV_RIGHT;
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'slider-step';
      down.tabIndex = -1;
      down.setAttribute('aria-label', 'Decrease');
      down.innerHTML = CHEV_LEFT;
      steppers.append(down, up);
      field.append(box, steppers);
      row.append(label, rng, field);
      sliders.append(row);
      ctx.el.append(sliders);

      const footer = document.createElement('div');
      footer.className = 'slice-footer';
      const outLabels = [];
      const outNums = [];
      for (let i = 0; i < 3; i += 1) {
        const item = document.createElement('span');
        item.className = 'slice-value';
        const key = document.createElement('b');
        const num = document.createElement('span');
        item.append(key, num);
        footer.append(item);
        outLabels.push(key);
        outNums.push(num);
      }
      ctx.el.append(footer);

      const modelNow = () => {
        const chosen = Models.get(modelId);
        if (chosen && Models.inFamily(chosen, store.viewFamily || 'all')) return chosen;
        return Models.get(Models.defaultForFamily(store.viewFamily || 'all')) || Models.get('okhsv');
      };
      const axesNow = () => Models.axesFor(modelNow(), store);
      const Overlay = window.IroPickerOverlay;
      const Gamut = window.IroSliderGamut;
      const Contour = window.IroContour;
      const DiscMap = window.IroDiscMap;
      const Cadence = window.IroRenderCadence;

      /** The plane the disc draws (see src/shared/disc-map.js). */
      const discPlane = (model) => DiscMap.discPlane(model);
      let lockLight = null;
      const metricsOf = () => {
        const r = canvas.getBoundingClientRect();
        return {
          left: r.left, top: r.top,
          clientLeft: canvas.clientLeft, clientTop: canvas.clientTop,
          clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight,
        };
      };

      const sizeCanvas = (cap = 2, nativeOnly = false) => {
        // A pixel budget instead of a fixed 2×: a disc stretched to the palette width
        // renders far more pixels and stutters. Below 1× is never used (no blurry upscale).
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

      // --- the radius -----------------------------------------------------------
      /** The disc's rim in model units (src/shared/disc-map.js#rimFor). */
      const scaleFor = (model) => DiscMap.rimFor(model, store);

      /** Model axes for a disc point (hue degrees, radius 0..1). */
      const axesAt = (model, axes, hue, r, scale) => DiscMap.axesAt(model, axes, hue, r, scale);

      /**
       * The disc point of the current colour: the exact inverse of `axesAt`, so the
       * pointer sits where the click goes. It is never re-derived from another
       * lightness — that used to collapse to the centre on some hues.
       */
      const pointOf = (model, axes, scale) => DiscMap.pointFromAxes(model, axes, scale, store);

      // --- raster ---------------------------------------------------------------
      const discCache = new Map();
      let lastDiscOff = null;
      let builtKey = '';
      let holdUntil = 0;
      const buildDisc = (w, h, model, axes, scale) => {
        const lIdx = lightAxis(model);
        const nativeLight = Models.usesNativeLight(model);
        const key = `d:${store.plotKeyTag()}:${model.id}:${axes[lIdx].toFixed(4)}:${scale.toFixed(4)}:${w}x${h}`;
        const hit = discCache.get(key);
        if (hit && hit.width === w && hit.height === h) return hit;
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        const img = c2d.createImageData(w, h);
        const data = img.data;
        const luma = new Float32Array(w * h).fill(NaN);
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) / 2 - 0.5;
        for (let y = 0; y < h; y += 1) {
          const ny = (y + 0.5 - cy) / radius;
          for (let x = 0; x < w; x += 1) {
            const nx = (x + 0.5 - cx) / radius;
            const r = Math.hypot(nx, ny);
            if (r > 1) continue; // outside the disc stays clear
            const hue = ((Math.atan2(ny, nx) * 180) / Math.PI + 360) % 360;
            const next = axesAt(model, axes, hue, r, scale);
            const lab = model.toLab(next);
            const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
            const inside = typeof model.inGamut === 'function'
              ? model.inGamut(next)
              : store.inGamut(lch.L, lch.C, lch.H);
            // The disc is a disc: a pixel the document cannot hold is still painted (the
            // sRGB stand-in at reduced opacity), never skipped into a bite out of the
            // circle. Its lightness is left out of the field so the guide stops there.
            // A pixel the document *can* hold but the screen cannot is painted as the
            // clipped colour (like any drawing app), dimmed only when the user asks to
            // see that region (`store.markOutOfDisplay`).
            const inSrgb = Color.inGamut(lch.L, lch.C, lch.H);
            const i = (y * w + x) * 4;
            // One region: everything the display cannot show, whether or not the document
            // can hold it. Painted as the pale stand-in, or left blank when the user turns
            // the option off — never as a second, fully coloured area (that hard edge is
            // what the user saw as a "harsh transition"). Inside the display gamut is the
            // true colour.
            let rgb;
            let alpha = 255;
            if (!inSrgb) {
              if (!showOutOfGamut) { data[i + 3] = 0; continue; }
              rgb = Color.fitToSrgb(lch.L, lch.C, lch.H);
              alpha = 140;
            } else {
              rgb = Color.oklabToRgb(lab.L, lab.a, lab.b);
            }
            data[i] = clamp255(rgb.r * 255);
            data[i + 1] = clamp255(rgb.g * 255);
            data[i + 2] = clamp255(rgb.b * 255);
            data[i + 3] = alpha;
            if (inside) luma[y * w + x] = nativeLight ? next[lIdx] : lab.L;
          }
        }
        c2d.putImageData(img, 0, 0);
        if (discCache.size > 6) discCache.clear();
        discCache.set(key, off);
        off.__luma = luma;
        // The lightness this map was built for, so the guide is traced from its own field.
        off.__target = nativeLight ? axes[lIdx] : G.lightnessOf(model, axes);
        return off;
      };

      // --- render ---------------------------------------------------------------
      let rafId = 0;
      const schedule = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => { rafId = 0; render(); });
      };

      const syncRange = (model, axes) => {
        const lIdx = lightAxis(model);
        const d = model.axes[lIdx];
        const r = G.range(model, lIdx, store);
        label.textContent = d.label;
        rng.min = String(r.min);
        rng.max = String(r.max);
        rng.step = 'any';
        rng.value = String(axes[lIdx]);
        box.value = Models.formatAxis(d, axes[lIdx]);
        rng.style.background = Gamut.gradientFor(model, lIdx, store, {
          axes, direction: '90deg', markOut: false,
        });
        sliders.classList.toggle('hide-numbers', hideNumbers);
      };

      // The guide currently drawn, in normalized disc coordinates ((-1,-1)..(1,1), the
      // rim is radius 1) and the lightness it was drawn for. A locked drag projects the
      // pointer onto this line: it is the only place the locked lightness really is.
      let lastDiscGuide = null;

      /** The iso-lightness guide: the contour of the disc's own lightness field. */
      const drawDiscGuide = (c2d, w, h, model, axes, target, scale) => {
        lastDiscGuide = null;
        if (!guideLines || !Contour) return;
        if (G.lightAxisIsCanonical(model)) return; // one lightness everywhere: no line
        const field = lastDiscOff && lastDiscOff.__luma;
        if (!field) return;
        // The field belongs to the map, which may differ in size from the canvas
        // (the interactive native-pixel build): index it with its own dimensions.
        const fw = lastDiscOff.width;
        const fh = lastDiscOff.height;
        const lines = Contour.isoLines(field, fw, fh, target, { stride: fw * fh > 120000 ? 2 : 1 });
        if (!lines.length) return;
        // Map the field's pixels onto the canvas (same 1:1 orientation as drawImage),
        // and keep the same line in disc coordinates for the locked pick.
        const sx = w / fw;
        const sy = h / fh;
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) / 2 - 0.5;
        const toDisc = (x, y) => [
          ((x * sx) - cx) / radius,
          ((y * sy) - cy) / radius,
        ];
        const segs = lines.map((pts) => pts.map(([x, y]) => { const d = toDisc(x, y); return [d[0] * radius + cx, d[1] * radius + cy]; }));
        lastDiscGuide = { lines: lines.map((pts) => pts.map(([x, y]) => toDisc(x, y))), target };
        Overlay.guide(c2d, segs, { locked: lockLight !== null, scale });
      };

      const render = () => {
        // The disc module is content-sized (`autoHeight`), and its box is always square:
        // the canvas takes the width and its height follows (`.disc-plot` has an
        // aspect-ratio of 1), so the card ends under the footer with no dead band and
        // the backing store can never be sized from a stale height.
        const { w, h } = sizeCanvas(2, store.interactive);
        if (w < 12 || h < 12) return;
        const dpr = w / Math.max(1, canvas.clientWidth);
        const model = modelNow();
        const axes = axesNow();
        const scale = scaleFor(model);
        const lIdx = lightAxis(model);
        const modelKey = `${store.plotKeyTag()}:${model.id}:${axes[lIdx].toFixed(4)}:${scale.toFixed(4)}:${w}x${h}`;
        const stale = !lastDiscOff || modelKey !== builtKey;
        const now = performance.now();
        // The disc follows the light row live. While a gesture is in flight the build is
        // paced by its own measured cost (never by the trailing full-quality one), so a
        // slow model cannot stall the pointer. The old image stays on screen until the
        // new one lands: clearing and returning here made the disc flash white on every
        // lightness change anywhere.
        if (stale && (!store.interactive || now >= holdUntil)) {
          const started = performance.now();
          lastDiscOff = buildDisc(w, h, model, axes, scale);
          builtKey = modelKey;
          if (store.interactive) holdUntil = performance.now() + Cadence.holdFor(performance.now() - started);
          else holdUntil = 0;
        }
        const off = lastDiscOff;
        if (!off) return;
        const c2d = canvas.getContext('2d');
        c2d.setTransform(1, 0, 0, 1, 0, 0);
        c2d.clearRect(0, 0, w, h);
        c2d.drawImage(off, 0, 0, w, h);

        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) / 2 - 0.5;
        drawDiscGuide(c2d, w, h, model, axes, lockLight != null
          ? lockLight
          // Idle: trace the contour from the light the displayed map was built at — a
          // paced rebuild traced at a newer target made the guide flash, jump, and miss
          // the pointer. During a drag the light row is moving and the guide must follow
          // the pointer, so use the live light over the current field instead of waiting
          // for the next paced build (the "guide does not update live" report).
          : (store.interactive || !lastDiscOff || !Number.isFinite(lastDiscOff.__target)
            ? G.lightnessOf(model, axes)
            : lastDiscOff.__target), dpr);
        // The ring shows the *picked* colour, not the cursor: with a locked lightness the
        // stored colour is solved onto the iso-lightness line, so the ring belongs there.
        const p = pointOf(model, axes, scale);
        const a = (p.hue * Math.PI) / 180;
        Overlay.pointer(c2d, cx + Math.cos(a) * radius * p.r, cy + Math.sin(a) * radius * p.r, {
          clamped: p.clamped, scale: dpr,
        });

        for (let i = 0; i < 3; i += 1) {
          outLabels[i].textContent = model.axes[i].key.toUpperCase();
          outNums[i].textContent = Models.formatAxis(model.axes[i], axes[i]);
        }
        syncRange(model, axes);
      };

      // --- interaction ----------------------------------------------------------

      /** Model axes for an event position: clamped to the rim, never null. */
      const axesFromEvent = (ev) => {
        if (!canvas.clientWidth || !canvas.clientHeight) return null;
        const model = modelNow();
        const axes = axesNow();
        const scale = scaleFor(model);
        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) / 2 - 0.5;
        const at = G.contentPoint(metricsOf(), ev.clientX, ev.clientY);
        const x = at.x * w;
        const y = at.y * h;
        const nx = (x - cx) / radius;
        const ny = (y - cy) / radius;
        const raw = Math.hypot(nx, ny);
        // A locked drag projects the pointer onto the *drawn* guide: that line is the
        // raster's own iso-lightness contour, so its nearest point is exactly the colour
        // under the cursor with the locked lightness. The solver below brackets the axis
        // from its low end, so on a non-monotone lightness curve (OKHSV at fixed V) it can
        // land on a far branch — the "pointer is nowhere near the cursor" report.
        let px = nx;
        let py = ny;
        let projected = false;
        if (lockLight !== null && lastDiscGuide && lastDiscGuide.target === lockLight) {
          const hit = Contour.nearestOnLines(lastDiscGuide.lines, nx, ny, 8, 8);
          if (hit) { px = hit.u; py = hit.v; projected = true; }
        }
        const r = Math.min(1, Math.hypot(px, py));
        const hue = ((Math.atan2(py, px) * 180) / Math.PI + 360) % 360;
        let next = axesAt(model, axes, hue, r, scale);
        let reject = false;
        if (lockLight !== null && !projected) {
          const held = G.applyLightness(model, discPlane(model), next, lockLight, store);
          if (!G.lightnessReached(model, held, lockLight)) reject = true;
          else next = held;
        }
        return {
          axes: next,
          model,
          reject,
          out: raw > 1,
        };
      };

      const applyPoint = (next, notify) => {
        const { model, axes } = next;
        let lab = model.toLab(axes);
        // A recorded value is inside the gamut: pull the chroma back to the
        // boundary (never raise it) whatever the model. This is the same
        // predicate the raster paints with, so shown == pickable.
        const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
        if (!store.inGamut(lch.L, lch.C, lch.H)) {
          const C = store.maxChroma(lch.L, lch.H);
          const rad = (lch.H * Math.PI) / 180;
          lab = { L: lch.L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
        }
        store.setLab(lab, { notify });
      };

      let dragging = false;
      canvas.addEventListener('pointerdown', (ev) => {
        lockLight = ev.shiftKey ? G.lightnessOf(modelNow(), axesNow()) : null;
        const next = axesFromEvent(ev);
        if (!next || next.out) { lockLight = null; return; }
        dragging = true;
        store.dragging = true;
        if (Input) Input.capture(canvas, ev.pointerId);
        if (!next.reject) applyPoint(next, 'live');
        ev.preventDefault();
      });
      canvas.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        if (ev.shiftKey && lockLight === null) {
          lockLight = G.lightnessOf(modelNow(), axesNow());
        } else if (!ev.shiftKey && lockLight !== null) {
          lockLight = null;
        }
        const next = axesFromEvent(ev);
        if (!next) return;
        if (!next.reject) applyPoint(next, 'live');
        schedule();
      });
      const end = () => {
        if (!dragging) return;
        dragging = false;
        lockLight = null;
        store.dragging = false;
        if (Input) Input.releaseAll();
        store.setLCH(store.lch(), { notify: 'commit' });
      };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
      const onReset = () => {
        if (!dragging && !store.dragging) return;
        dragging = false;
        lockLight = null;
        store.dragging = false;
        if (Input) Input.releaseAll();
        schedule();
      };
      window.addEventListener('iro:input-reset', onReset);
      resetCleanup = () => window.removeEventListener('iro:input-reset', onReset);

      rng.addEventListener('pointerdown', () => {
        store.dragging = true;
        lockLight = null;
      });
      rng.addEventListener('input', () => {
        store.dragging = true;
        lockLight = null;
        const model = modelNow();
        const axes = axesNow();
        axes[lightAxis(model)] = Number(rng.value);
        store.setLab(model.toLab(axes), { notify: 'live' });
      });
      const releaseRange = () => {
        store.dragging = false;
        store.setLCH(store.lch(), { notify: 'commit' });
      };
      rng.addEventListener('change', releaseRange);
      rng.addEventListener('pointerup', releaseRange);
      rng.addEventListener('pointercancel', releaseRange);
      rng.addEventListener('blur', releaseRange);

      const commitBox = () => {
        const model = modelNow();
        const li = lightAxis(model);
        const d = model.axes[li];
        const r = G.range(model, li, store);
        const parsed = Number(box.value);
        if (!Number.isFinite(parsed)) { syncRange(model, axesNow()); return; }
        const axes = axesNow();
        axes[li] = clamp(parsed / (d.scale || 1), r.min, r.max);
        store.setLab(model.toLab(axes), { notify: 'commit' });
      };
      box.addEventListener('change', commitBox);
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter') box.blur(); });
      const nudge = (dir) => {
        const model = modelNow();
        const li = lightAxis(model);
        const d = model.axes[li];
        const r = G.range(model, li, store);
        const step = 1 / ((d.scale || 1) * (d.fmt ? 10 ** d.fmt : 1));
        const axes = axesNow();
        axes[li] = clamp(axes[li] + dir * step, r.min, r.max);
        store.setLab(model.toLab(axes), { notify: 'commit' });
      };
      up.addEventListener('click', () => nudge(1));
      down.addEventListener('click', () => nudge(-1));

      const unsubscribe = store.subscribe(schedule);
      render();

      return {
        onResize() { schedule(); },
        onSettings(settings) {
          if (settings.model !== undefined) {
            const next = discModel(settings.model, AVAILABLE);
            if (next !== modelId) {
              modelId = next;
              discCache.clear();
              lastDiscOff = null;
              lockLight = null;
            }
          }
          if (settings.hideNumbers !== undefined) hideNumbers = settings.hideNumbers === true;
          if (settings.guideLines !== undefined) guideLines = settings.guideLines !== false;
          if (settings.showOutOfGamut !== undefined) {
            const nextOut = settings.showOutOfGamut !== false;
            if (nextOut !== showOutOfGamut) {
              showOutOfGamut = nextOut;
              discCache.clear();
              lastDiscOff = null;
            }
          }
          footer.classList.toggle('hidden', hideNumbers);
          sliders.classList.toggle('hide-numbers', hideNumbers);
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

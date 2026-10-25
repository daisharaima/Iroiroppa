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

  const DISC_MODELS = ['oklch', 'oklab', 'okhsv', 'okhsl', 'helmgenlch', 'helmgen'];

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp255 = (x) => clamp(Math.round(x), 0, 255);

  /** The index of the axis the disc holds: L for OKLCH/OKLab, V/L for Okhsv/Okhsl. */
  const lightAxis = (model) => (model.hueIndex === 0 ? 2 : 0);

  const settingsUI = (api, root) => {
    const row = document.createElement('label');
    row.className = 'pop-row';
    const name = document.createElement('span');
    name.textContent = window.Iro.t('module.settings.model');
    const sel = document.createElement('select');
    sel.className = 'pop-select';
    for (const m of Models.list()) {
      if (!DISC_MODELS.includes(m.id)) continue;
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      sel.append(opt);
    }
    sel.value = DISC_MODELS.includes(api.get().model) ? api.get().model : 'okhsv';
    sel.addEventListener('change', () => api.patch({ model: sel.value }));
    row.append(name, sel);
    root.append(row);

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
  };

  reg.modules['color-disc'] = {
    id: 'color-disc',
    name: 'Color Disc',
    version: 1,
    defaults: { model: 'okhsv', hideNumbers: false },
    settingsUI,
    minSize() { return { width: 140, height: 190 }; },

    create(ctx) {
      const Color = window.Color;
      const store = ctx.color;
      const AVAILABLE = DISC_MODELS.filter((id) => Models.has(id));

      let modelId = AVAILABLE.includes(ctx.settings.get().model) ? ctx.settings.get().model : 'okhsv';
      let hideNumbers = ctx.settings.get().hideNumbers === true;

      const body = document.createElement('div');
      body.className = 'disc-body';
      const canvas = document.createElement('canvas');
      canvas.className = 'disc-plot';
      body.append(canvas);
      ctx.el.append(body);

      // The held axis: native range, its own track.
      const range = document.createElement('input');
      range.type = 'range';
      range.className = 'disc-range pop-range';
      range.step = '0.001';
      ctx.el.append(range);

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

      const modelNow = () => Models.get(modelId) || Models.get('okhsv');
      const axesNow = () => Models.axesFor(modelNow(), store);

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

      // --- the radius -----------------------------------------------------------
      /** The disc's rim, in model units: 1 for the dense models, the widest hue's
       *  chroma at this lightness *in the model's own axis units* (so a model whose
       *  chroma scale differs from OKLCH still fills the disc). */
      const scaleFor = (model, axes) => {
        if (model.dense) return 1;
        const lab = model.toLab(axes);
        const L = Color.oklabToOklch(lab.L, lab.a, lab.b).L;
        let maxC = 0;
        for (let i = 0; i < 90; i += 1) {
          const H = (i / 90) * 360;
          // The gamut body, not the thin primary fin: a fin's far end would set the
          // rim and leave every other hue looking shrunken.
          const ivs = typeof store.chromaIntervals === 'function' ? store.chromaIntervals(L, H) : [];
          const C = ivs.length ? ivs[0][1] : store.maxChroma(L, H);
          if (!(C > 0)) continue;
          const at = model.fromLab(Color.oklchToOklab(L, C, H));
          maxC = Math.max(maxC, model.hueIndex == null ? Math.hypot(at[1], at[2]) : at[1]);
        }
        return maxC > 1e-6 ? maxC : model.axes[1].max;
      };

      /** Model axes for a disc point (hue degrees, radius 0..1). */
      const axesAt = (model, axes, hue, r, scale) => {
        const out = axes.slice();
        if (model.hueIndex == null) {
          // A rectangular model has no hue axis: the disc angle is the a/b angle.
          const rad = (hue * Math.PI) / 180;
          const C = r * scale;
          out[1] = C * Math.cos(rad);
          out[2] = C * Math.sin(rad);
          return out;
        }
        out[model.hueIndex] = hue;
        out[1] = model.dense ? r * model.axes[1].max : r * scale;
        return out;
      };

      /** The disc point of the current colour. */
      const pointOf = (model, axes, scale) => {
        if (model.hueIndex == null) {
          const C = Math.hypot(axes[1], axes[2]);
          const hue = ((Math.atan2(axes[2], axes[1]) * 180) / Math.PI + 360) % 360;
          return { hue, r: scale > 0 ? clamp(C / scale, 0, 1) : 0 };
        }
        const hue = axes[model.hueIndex];
        const r = model.dense
          ? clamp(axes[1] / (model.axes[1].max || 1), 0, 1)
          : clamp(axes[1] / (scale || 1), 0, 1);
        return { hue, r };
      };

      // --- raster ---------------------------------------------------------------
      const discCache = new Map();
      const buildDisc = (w, h, model, axes, scale) => {
        const lIdx = lightAxis(model);
        const key = `d:${store.plotKeyTag()}:${model.id}:${axes[lIdx].toFixed(4)}:${scale.toFixed(4)}:${w}x${h}`;
        const hit = discCache.get(key);
        if (hit && hit.width === w && hit.height === h) return hit;
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2d = off.getContext('2d');
        const img = c2d.createImageData(w, h);
        const data = img.data;
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
            const inside = model.dense || store.inGamut(lch.L, lch.C, lch.H);
            if (!inside) continue; // a silhouette: the shape is the gamut
            const rgb = Color.fitToSrgb(lch.L, lch.C, lch.H);
            const i = (y * w + x) * 4;
            data[i] = clamp255(rgb.r * 255);
            data[i + 1] = clamp255(rgb.g * 255);
            data[i + 2] = clamp255(rgb.b * 255);
            data[i + 3] = 255;
          }
        }
        c2d.putImageData(img, 0, 0);
        if (discCache.size > 6) discCache.clear();
        discCache.set(key, off);
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
        const ax = model.axes[lIdx];
        range.min = String(ax.min);
        range.max = String(ax.max);
        range.value = String(axes[lIdx]);
      };

      const render = () => {
        // The disc is a circle: keep the canvas square even when the module is
        // taller than it is wide, so the shape does not sit in empty space.
        if (canvas.clientWidth > 0 && canvas.clientHeight > canvas.clientWidth) {
          canvas.style.height = `${canvas.clientWidth}px`;
        }
        const { w, h } = sizeCanvas(2);
        if (w < 12 || h < 12) return;
        const model = modelNow();
        const axes = axesNow();
        const scale = scaleFor(model, axes);
        const c2d = canvas.getContext('2d');
        c2d.setTransform(1, 0, 0, 1, 0, 0);
        c2d.clearRect(0, 0, w, h);
        c2d.drawImage(buildDisc(w, h, model, axes, scale), 0, 0);

        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) / 2 - 0.5;
        if (store.crosshair) {
          const p = pointOf(model, axes, scale);
          const a = (p.hue * Math.PI) / 180;
          c2d.beginPath();
          c2d.arc(cx + Math.cos(a) * radius * p.r, cy + Math.sin(a) * radius * p.r, 4, 0, Math.PI * 2);
          c2d.lineWidth = 1.5;
          c2d.strokeStyle = 'rgba(0,0,0,0.75)';
          c2d.stroke();
          c2d.strokeStyle = 'rgba(255,255,255,0.9)';
          c2d.lineWidth = 1;
          c2d.stroke();
        }

        for (let i = 0; i < 3; i += 1) {
          outLabels[i].textContent = model.axes[i].key.toUpperCase();
          outNums[i].textContent = Models.formatAxis(model.axes[i], axes[i]);
        }
        syncRange(model, axes);
      };

      // --- interaction ----------------------------------------------------------
      /** Model axes for an event position, or null outside the disc. */
      const axesFromEvent = (ev) => {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const model = modelNow();
        const axes = axesNow();
        const scale = scaleFor(model, axes);
        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) / 2 - 0.5;
        const x = ((ev.clientX - rect.left) / rect.width) * w;
        const y = ((ev.clientY - rect.top) / rect.height) * h;
        const nx = (x - cx) / radius;
        const ny = (y - cy) / radius;
        const r = Math.hypot(nx, ny);
        if (r > 1) return null;
        const hue = ((Math.atan2(ny, nx) * 180) / Math.PI + 360) % 360;
        return { axes: axesAt(model, axes, hue, r, scale), model };
      };

      const applyPoint = (next, notify) => {
        const { model, axes } = next;
        let lab = model.toLab(axes);
        if (!model.dense) {
          // Recorded values are always inside the gamut: pull the chroma back to
          // the boundary (never raise it) for OKLCH/OKLab.
          const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
          if (!store.inGamut(lch.L, lch.C, lch.H)) {
            const C = store.maxChroma(lch.L, lch.H);
            const rad = (lch.H * Math.PI) / 180;
            lab = { L: lch.L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
          }
        }
        store.setLab(lab, { notify });
      };

      let dragging = false;
      canvas.addEventListener('pointerdown', (ev) => {
        const next = axesFromEvent(ev);
        if (!next) return;
        dragging = true;
        store.dragging = true;
        canvas.setPointerCapture(ev.pointerId);
        applyPoint(next, 'live');
        ev.preventDefault();
      });
      canvas.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        const next = axesFromEvent(ev);
        if (next) applyPoint(next, 'live');
      });
      const end = () => {
        if (!dragging) return;
        dragging = false;
        store.dragging = false;
        store.setLCH(store.lch(), { notify: 'commit' });
      };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);

      range.addEventListener('input', () => {
        const model = modelNow();
        const axes = axesNow();
        axes[lightAxis(model)] = Number(range.value);
        store.setLab(model.toLab(axes), { notify: 'live' });
      });
      range.addEventListener('change', () => store.setLCH(store.lch(), { notify: 'commit' }));

      const unsubscribe = store.subscribe(schedule);
      render();

      return {
        onResize() { schedule(); },
        onSettings(settings) {
          if (settings.model !== undefined) {
            const next = AVAILABLE.includes(settings.model) ? settings.model : 'okhsv';
            if (next !== modelId) {
              modelId = next;
              discCache.clear();
            }
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

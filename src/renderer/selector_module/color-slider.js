'use strict';

// Selector module: the colour slider. Its three rows are the active model's
// three axes (OKLCH by default) — the model is a view, so this is the picker's
// "type the numbers" surface.
//
// Each row is a native range plus an editable numeric field. The range spans the
// axis, and its track is coloured only where the value is in the working gamut;
// the rest is the blank colour. Dragging into the blank keeps the marker in the
// blank but the colour clamps to the nearest in-gamut value on that axis, so one
// row never changes another. Arrow keys nudge by one display unit.
//
// Horizontal in a wide box; vertical when the box is taller than it is wide. The
// rows share the box evenly and the track's thickness is a percentage of that
// share.

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};
  const Models = window.IroColorModels;
  const G = window.IroSliceGeometry;

  const MIN_ROW = 14; // the smallest usable base-line pitch
  const AXIS_IDS = ['L', 'C', 'H']; // DOM ids stay L/C/H in every model (the shot reads them)
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const pctOf = (value) => Math.round(clamp(Number(value) || 70, 10, 100));
  const visibleRows = (settings) => ['showL', 'showC', 'showH'].filter((k) => settings[k] !== false).length || 1;
  const CHEV_UP = '<svg viewBox="0 0 10 10"><path d="M2.5 4 5 1.5 7.5 4"/><path d="M2.5 8 5 5.5 7.5 8"/></svg>';
  const CHEV_DOWN = '<svg viewBox="0 0 10 10"><path d="M2.5 2 5 4.5 7.5 2"/><path d="M2.5 6 5 8.5 7.5 6"/></svg>';
  const ARROW_LEFT = '<svg viewBox="0 0 10 10"><path d="M7.5 2 4 5l3.5 3"/></svg>';
  const ARROW_RIGHT = '<svg viewBox="0 0 10 10"><path d="M2.5 2 6 5l-3.5 3"/></svg>';

  /** The slider settings UI, shared by the popover and the Settings window. */
  const settingsUI = (api, root, store) => {
    const model = Models.get(api.get().model) || Models.get(Models.DEFAULT_ID);
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
    const addRange = (key, label, min, max, fmt) => {
      const row = document.createElement('label');
      row.className = 'pop-row pop-row-range';
      const name = document.createElement('span');
      name.textContent = label;
      const rng = document.createElement('input');
      rng.type = 'range';
      rng.className = 'pop-range';
      rng.min = String(min);
      rng.max = String(max);
      rng.step = '1';
      const value = Number(api.get()[key]);
      rng.value = String(Number.isFinite(value) ? value : min);
      const out = document.createElement('span');
      out.className = 'pop-range-value';
      const show = (v) => { out.textContent = fmt ? fmt(v) : String(v); };
      show(rng.value);
      rng.addEventListener('input', () => {
        api.patch({ [key]: Number(rng.value) });
        show(rng.value);
      });
      row.append(name, rng, out);
      root.append(row);
    };
    const modelRow = document.createElement('label');
    modelRow.className = 'pop-row';
    const modelName = document.createElement('span');
    modelName.textContent = window.Iro.t('module.settings.model');
    modelRow.append(modelName);
    window.IroModelOptions.menu(modelRow, {
      groups: window.IroModelOptions.groups(Models.listForFamily(store.viewFamily || 'all')),
      value: Models.inFamily(Models.get(api.get().model) || Models.get(Models.DEFAULT_ID), store.viewFamily || 'all')
        ? api.get().model
        : Models.defaultForFamily(store.viewFamily || 'all'),
      onChange: (id) => api.patch({ model: id }),
    });
    root.append(modelRow);

    addToggle('showL', 'Show 1st channel');
    addToggle('showC', 'Show 2nd channel');
    addToggle('showH', 'Show 3rd channel');
    addToggle('hideNumbers', 'Hide Values');
    // Per-axis out-of-gamut marking. Off leaves the whole track coloured; the
    // edge is then not drawn for that axis only.
    const axisName = (i) => (model.axes[i] && model.axes[i].label) || String(i + 1);
    addToggle('showOutL', `Mark out of gamut — ${axisName(0)}`);
    addToggle('showOutC', `Mark out of gamut — ${axisName(1)}`);
    addToggle('showOutH', `Mark out of gamut — ${axisName(2)}`);
    addRange('thickness', 'Thickness', 10, 100, (v) => `${v}%`);
    const addSelect = (key, label, options) => {
      const row = document.createElement('label');
      row.className = 'pop-row';
      const name = document.createElement('span');
      name.textContent = label;
      row.append(name);
      window.IroModelOptions.menu(row, {
        items: options.map(([value, text]) => ({ value, label: text })),
        value: api.get()[key] === 'vertical' ? 'vertical' : 'horizontal',
        onChange: (v) => api.patch({ [key]: v }),
      });
      root.append(row);
    };
    addSelect('orientation', 'Orientation', [['horizontal', 'Horizontal'], ['vertical', 'Vertical']]);
    const hint = document.createElement('div');
    hint.className = 'pop-hint';
    hint.textContent = window.Iro.t('module.slices.guideLock');
    root.append(hint);
  };

  reg.modules['color-slider'] = {
    id: 'color-slider',
    name: 'Color Slider',
    version: 4,
    defaults: { model: 'oklch', showL: true, showC: true, showH: true, hideNumbers: false, orientation: 'horizontal', thickness: 70, showOutL: true, showOutC: true, showOutH: true },
    settingsUI,
    /**
     * v1 stored a pixel thickness (2–24) plus a pixel gap; v2 made the thickness a
     * percentage of that gap. Both are gone: keep the percentage, drop the gap.
     */
    migrate(stored) {
      const s = { ...stored };
      const hadGap = Object.prototype.hasOwnProperty.call(s, 'gap');
      delete s.gap;
      const t = Number(s.thickness);
      if (!Number.isFinite(t)) return s;
      // A v1 pixel value, converted against the pitch it used to sit in.
      s.thickness = hadGap && t <= 24 ? pctOf(Math.round((t / 22) * 100)) : pctOf(t);
      return s;
    },
    /** The smallest box that keeps every visible row usable (the mounted instance
     *  reports the orientation-aware size). */
    minSize(settings) {
      return { width: 96, height: 24 + Math.round(visibleRows(settings) * MIN_ROW) };
    },

    create(ctx) {
      const Color = window.Color;
      const store = ctx.color;

      const wrap = document.createElement('section');
      wrap.className = 'sliders';

      const rows = [];
      const makeRow = (index) => {
        const row = document.createElement('div');
        row.className = 'slider-row';
        const name = document.createElement('span');
        name.className = 'slider-label';
        const rng = document.createElement('input');
        rng.className = 'rng';
        rng.type = 'range';
        rng.id = `rng-${AXIS_IDS[index]}`;
        const box = document.createElement('input');
        box.className = 'slider-value';
        box.type = 'text';
        box.id = `val-${AXIS_IDS[index]}`;
        box.spellcheck = false;
        box.setAttribute('aria-label', `Value ${index + 1}`);
        const field = document.createElement('div');
        field.className = 'slider-field';
        const steppers = document.createElement('div');
        steppers.className = 'slider-steppers';
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'slider-step';
        up.tabIndex = -1;
        up.setAttribute('aria-label', 'Increase');
        up.innerHTML = CHEV_UP;
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'slider-step';
        down.tabIndex = -1;
        down.setAttribute('aria-label', 'Decrease');
        down.innerHTML = CHEV_DOWN;
        // DOM order is decrease-then-increase: with the stepper reversed for a
        // vertical row that reads up/down, and with a horizontal row left/right.
        steppers.append(down, up);
        field.append(box, steppers);
        const track = document.createElement('div');
        track.className = 'rng-wrap';
        track.append(rng);
        row.append(name, track, field);
        wrap.append(row);
        rows.push({ row, rng, box, name, up, down, steppers, track });
      };
      makeRow(0);
      makeRow(1);
      makeRow(2);
      ctx.el.append(wrap);

      let modelId = Models.DEFAULT_ID;
      let vertical = false;
      let current = {};
      let draggingRow = -1;
      let lockLight = null;
      let resetCleanup = null;
      const raw = [0, 0, 0]; // the marker's position (may sit in the blank past the gamut)
      const trackCache = [0, 1, 2].map(() => ({
        key: '', css: '', lastAt: 0,
      }));
      wrap.dataset.orientation = 'horizontal';

      const model = () => {
        const chosen = Models.get(modelId);
        if (chosen && Models.inFamily(chosen, store.viewFamily || 'all')) return chosen;
        return Models.get(Models.defaultForFamily(store.viewFamily || 'all')) || Models.get(Models.DEFAULT_ID);
      };

      /** The axis range; OKLCH's chroma spans the working gamut. */
      const range = (m, i) => G.range(m, i, store);
      const Gamut = window.IroSliderGamut;
      const inGamutAt = (m, axes, i, v) => Gamut.inGamutAt(m, axes, i, v, store);
      const nearestInGamut = (m, i, desired, axes) => Gamut.nearestInGamut(m, i, store, axes, desired);

      /** A row's track: coloured only where this axis is in gamut, blank elsewhere. */
      const rowGradient = (m, i, dir, axes) => Gamut.gradientFor(m, i, store, {
        axes,
        direction: dir,
        markOut: current['showOut' + AXIS_IDS[i]] !== false,
      });

      /** Key ignoring the dragged axis: a track does not depend on its own value. */
      const trackKey = (m, i, axes, dir) => {
        const others = [0, 1, 2].map((k) => (k === i ? '-' : axes[k].toFixed(5))).join(',');
        return `${m.id}:${i}:${dir}:${others}:${store.plotKeyTag()}:${current['showOut' + AXIS_IDS[i]] !== false}`;
      };

      /** The precision the readout shows; the nudge arrows are the only quantised input. */
      const displayStep = (a) => 1 / ((a.scale || 1) * (a.fmt ? 10 ** a.fmt : 1));

      const renderNow = () => {
        const m = model();
        const axes = Models.axesFor(m, store);
        const dir = vertical ? '0deg' : '90deg';
        const now = performance.now();
        for (let i = 0; i < 3; i++) {
          const a = m.axes[i];
          const r = range(m, i);
          // If the stored value no longer matches the dragged marker, a change
          // came from elsewhere: adopt it. While this row is being dragged the
          // marker owns the value and is left where the user put it.
          if (draggingRow !== i) raw[i] = axes[i];
          rows[i].name.textContent = a.label;
          rows[i].rng.min = String(r.min);
          rows[i].rng.max = String(r.max);
          // Continuous: stepping is the nudge arrows' job, not the pointer's.
          rows[i].rng.step = 'any';
          rows[i].rng.value = String(clamp(raw[i], r.min, r.max));
          rows[i].box.value = Models.formatAxis(a, axes[i]);
          const key = trackKey(m, i, axes, dir);
          const cache = trackCache[i];
          // The dragged row's track is independent of its own value, so it need
          // not rebuild. Other rows change with the dragged axis; defer their
          // secondary gradients to a ~100 ms cadence.
          const due = !store.interactive || i === draggingRow || now - cache.lastAt > 100;
          if (due && cache.key !== key) {
            cache.key = key;
            cache.css = rowGradient(m, i, dir, axes);
            cache.lastAt = now;
            rows[i].rng.style.background = cache.css;
          } else if (!cache.css) {
            cache.css = rowGradient(m, i, dir, axes);
            cache.key = key;
            cache.lastAt = now;
            rows[i].rng.style.background = cache.css;
          }
        }
      };

      // The gradients are ~150 colour conversions plus long strings; a live drag
      // emits far faster than the display, so coalesce to one rebuild per frame.
      let rafId = 0;
      const render = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          renderNow();
        });
      };

      const setAxis = (i, value, notify) => {
        const m = model();
        const axes = Models.axesFor(m, store);
        axes[i] = value;
        store.setLab(m.toLab(axes), { notify });
      };

      for (let i = 0; i < 3; i++) {
        rows[i].rng.addEventListener('pointerdown', (ev) => {
          draggingRow = i;
          store.dragging = true;
          // Shift on a non-light row holds canonical lightness; the light row is
          // solved automatically. Shift on the light row itself just drags L.
          lockLight = ev.shiftKey && i !== Models.lightAxis(model())
            ? G.lightnessOf(model(), Models.axesFor(model(), store))
            : null;
        });
        rows[i].rng.addEventListener('pointermove', (ev) => {
          if (draggingRow !== i) return;
          if (i === Models.lightAxis(model())) return;
          if (ev.shiftKey && lockLight === null) {
            lockLight = G.lightnessOf(model(), Models.axesFor(model(), store));
          } else if (!ev.shiftKey && lockLight !== null) {
            lockLight = null;
          }
        });
        rows[i].rng.addEventListener('input', () => {
          draggingRow = i;
          store.dragging = true;
          const m = model();
          const li = Models.lightAxis(m);
          const value = Number(rows[i].rng.value);
          raw[i] = value;
          if (lockLight !== null && i !== li) {
            const axes = Models.axesFor(m, store);
            axes[i] = value;
            const held = G.setLightness(m, axes, lockLight, store);
            if (!G.lightnessReached(m, held, lockLight)) return;
            raw[li] = held[li];
            store.setLab(m.toLab(held), { notify: 'live' });
            return;
          }
          // The slider is allowed to leave the gamut: that is what moves the Slices'
          // crosshair into their out-of-gamut (hatched) area. Only recorded values
          // and slice drags snap; this pick is neither.
          setAxis(i, raw[i], 'live');
        });
        const release = () => {
          if (draggingRow === i) draggingRow = -1;
          lockLight = null;
          store.dragging = false;
          store.setLab(store.lab(), { notify: 'commit' });
        };
        rows[i].rng.addEventListener('change', release);
        rows[i].rng.addEventListener('pointerup', release);
        const commitBox = () => {
          const m = model();
          const a = m.axes[i];
          const parsed = Number(rows[i].box.value);
          if (!Number.isFinite(parsed)) { renderNow(); return; }
          raw[i] = parsed / (a.scale || 1);
          // Typed values may also sit out of gamut, like a drag; they are not a
          // recorded colour until written to CSP, and `contentRgb` clamps that.
          setAxis(i, raw[i], 'commit');
        };
        rows[i].box.addEventListener('change', commitBox);
        rows[i].box.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { rows[i].box.blur(); }
        });
        const nudge = (dir) => {
          const m = model();
          const a = m.axes[i];
          const hue = i === m.hueIndex;
          // Hue nudges by a whole degree; the other axes land on the displayed
          // precision. The arrow is the one control that quantises.
          const step = hue ? 1 : displayStep(a);
          const base = Models.axesFor(m, store)[i];
          const snapped = hue ? Math.round(base) : Math.round(base / step) * step;
          raw[i] = snapped + dir * step;
          setAxis(i, raw[i], 'commit');
        };
        rows[i].up.addEventListener('click', () => nudge(1));
        rows[i].down.addEventListener('click', () => nudge(-1));
      }

      const unsubscribe = store.subscribe(render);
      render();
      const onReset = () => {
        draggingRow = -1;
        lockLight = null;
        store.dragging = false;
      };
      window.addEventListener('iro:input-reset', onReset);
      resetCleanup = () => window.removeEventListener('iro:input-reset', onReset);

      return {
        onResize({ width }) {
          const rowsCount = visibleRows(current);
          const compact = vertical
            ? (width - 4 * (rowsCount - 1)) / rowsCount < 26
            : width < 84;
          wrap.classList.toggle('compact', compact);
        },
        onSettings(settings) {
          current = { ...settings };
          const nextModel = Models.has(settings.model) ? settings.model : Models.DEFAULT_ID;
          if (nextModel !== modelId) {
            modelId = nextModel;
            lockLight = null;
            const m = model();
            for (let i = 0; i < 3; i++) raw[i] = Models.axesFor(m, store)[i];
          }
          const next = settings.orientation === 'vertical';
          if (next !== vertical) {
            vertical = next;
            wrap.dataset.orientation = next ? 'vertical' : 'horizontal';
            render();
            if (ctx.requestLayout) ctx.requestLayout();
          }
          // Horizontal reads as left/right, vertical as up/down; the aria labels
          // stay increase/decrease (the axis meaning is unchanged).
          for (const r of rows) {
            r.up.innerHTML = vertical ? CHEV_UP : ARROW_RIGHT;
            r.down.innerHTML = vertical ? CHEV_DOWN : ARROW_LEFT;
          }
          rows[0].row.classList.toggle('hidden', settings.showL === false);
          rows[1].row.classList.toggle('hidden', settings.showC === false);
          rows[2].row.classList.toggle('hidden', settings.showH === false);
          wrap.style.setProperty('--slider-pct', String(pctOf(settings.thickness) / 100));
          wrap.classList.toggle('hide-numbers', settings.hideNumbers === true);
          renderNow();
        },
        /** Orientation-aware minimum, so a vertical slider can get its cross size. */
        minSize() {
          const cross = Math.round(visibleRows(current) * MIN_ROW);
          return vertical
            ? { width: cross + 10, height: 84 }
            : { width: 96, height: 24 + cross };
        },
        settings(root) { settingsUI(ctx.settings, root, ctx.color); },
        destroy() { if (resetCleanup) resetCleanup(); if (rafId) cancelAnimationFrame(rafId); unsubscribe(); },
      };
    },
  };
})();

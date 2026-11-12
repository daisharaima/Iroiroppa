'use strict';

// The Lens window: the lenses over one selector instance.
//
// A lens is not a module — it has no board slot and no manifest entry. It latches onto
// the instance that opened this window, and what it edits is that instance's own stored
// settings (`lens` inside `modules/<id>.json`), so duplicating the instance duplicates
// its lens and unmounting it takes the lens away.
//
// v1 has one lens (Quantize) and one source of bands (a per-channel bit grid over the
// document's channels). The pick half is not optional: `src/shared/lens.js` is the same
// function the map paints with, so nothing here can show a colour the pick would not
// record (docs/INVARIANTS.md, "a lens is one function").

(function () {
  const csp = window.csp;
  const Lens = window.IroLens;
  const params = new URLSearchParams(location.search);
  const instanceId = params.get('instanceId') || '';
  const moduleId = params.get('moduleId') || '';
  const moduleName = params.get('name') || moduleId;
  const root = document.getElementById('lens-root');
  const titleEl = document.getElementById('lens-title');

  const t = (key, vars) => window.Iro.t(key, vars);

  // The document's channel labels. The grid is always three channels: a LUT/CMYK profile
  // in this app is a soft proof over an sRGB document, so it has no ink channels of its
  // own (`.scratch/color-lens/DECISIONS.md`, B1).
  const CHANNEL_LABELS = ['R', 'G', 'B'];

  const state = {
    active: params.get('active') === 'quantize' ? 'quantize' : null,
    bits: (params.get('bits') || '3,3,3').split(',').map((n) => Number(n)),
  };
  state.bits = Lens.normaliseBits(state.bits);

  function fitWindow() {
    const app = document.getElementById('app');
    if (!app) return;
    const body = document.querySelector('.lens-body');
    const prev = body ? body.style.overflow : '';
    if (body) body.style.overflow = 'visible';
    const content = Math.ceil(Math.max(app.offsetHeight, app.scrollHeight, document.body.scrollHeight));
    if (body) body.style.overflow = prev;
    csp.resizeLens(content);
  }

  /** Push the whole lens to the instance (one writer: its own settings store). */
  function commit() {
    csp.setLens(instanceId, {
      active: state.active,
      quantize: { bits: state.bits.slice() },
    });
  }

  // --- rows -------------------------------------------------------------------

  function statusLine() {
    const line = document.createElement('p');
    line.className = 'lens-status';
    if (state.active !== 'quantize') {
      line.textContent = t('lens.status.none');
      return line;
    }
    if (Lens.inert(state.bits)) {
      line.textContent = t('lens.status.inert');
      return line;
    }
    const n = Lens.countFor(state.bits);
    line.textContent = t('lens.status.colours', { n, bits: Lens.label(state.bits) });
    return line;
  }

  function lensRow(id, labelKey, descriptionKey) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lens-row';
    row.dataset.lens = id;
    const on = state.active === id;
    row.classList.toggle('selected', on);
    const dot = document.createElement('span');
    dot.className = 'lens-dot';
    dot.classList.toggle('on', on);
    const name = document.createElement('span');
    name.className = 'lens-name';
    name.textContent = t(labelKey);
    row.append(dot, name);
    row.addEventListener('click', () => {
      state.active = on ? null : id;
      render();
      commit();
    });
    if (descriptionKey) {
      const desc = document.createElement('span');
      desc.className = 'lens-desc';
      desc.textContent = t(descriptionKey);
      row.append(desc);
    }
    return row;
  }

  function stepper(index) {
    const wrap = document.createElement('div');
    wrap.className = 'lens-stepper';
    const label = document.createElement('span');
    label.className = 'lens-channel';
    label.textContent = CHANNEL_LABELS[index] || String(index + 1);
    const rng = document.createElement('input');
    rng.type = 'range';
    rng.min = String(Lens.MIN_BITS);
    rng.max = String(Lens.MAX_BITS);
    rng.step = '1';
    rng.value = String(state.bits[index]);
    rng.className = 'lens-range';
    const out = document.createElement('output');
    out.className = 'lens-bits';
    out.textContent = t('lens.bits', { n: state.bits[index] });
    rng.addEventListener('input', () => {
      state.bits[index] = Number(rng.value);
      out.textContent = t('lens.bits', { n: state.bits[index] });
      const status = root.querySelector('.lens-status');
      if (status) status.replaceWith(statusLine());
      commit();
    });
    wrap.append(label, rng, out);
    return wrap;
  }

  function presetRow() {
    const row = document.createElement('div');
    row.className = 'lens-presets';
    for (let b = Lens.MIN_BITS; b <= Lens.MAX_BITS; b += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lens-preset';
      btn.textContent = String(b);
      btn.title = t('lens.presetTitle', { n: b });
      btn.classList.toggle('selected', state.bits.every((v) => v === b));
      btn.addEventListener('click', () => {
        state.bits = Lens.normaliseBits([b, b, b]);
        render();
        commit();
      });
      row.append(btn);
    }
    return row;
  }

  function quantizePage() {
    const page = document.createElement('div');
    page.className = 'lens-page';
    page.append(presetRow());
    for (let i = 0; i < 3; i += 1) page.append(stepper(i));
    const note = document.createElement('p');
    note.className = 'lens-note';
    note.textContent = t('lens.note.channels');
    page.append(note);
    return page;
  }

  function render() {
    titleEl.textContent = t('lens.title', { name: moduleName });
    root.replaceChildren();

    const list = document.createElement('div');
    list.className = 'lens-list';
    // "None" is a row of its own, so clearing a lens is one click in the list.
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'lens-row';
    none.dataset.lens = '';
    none.classList.toggle('selected', state.active === null);
    const noneDot = document.createElement('span');
    noneDot.className = 'lens-dot';
    noneDot.classList.toggle('on', state.active === null);
    const noneName = document.createElement('span');
    noneName.className = 'lens-name';
    noneName.textContent = t('lens.none');
    none.append(noneDot, noneName);
    none.addEventListener('click', () => {
      state.active = null;
      render();
      commit();
    });
    list.append(none);
    list.append(lensRow('quantize', 'lens.quantize', 'lens.quantizeDesc'));
    root.append(list);

    if (state.active === 'quantize') root.append(quantizePage());
    root.append(statusLine());
    requestAnimationFrame(fitWindow);
  }

  // The instance persists the lens; this window must show what it actually stored (a
  // re-fitted bit depth, or a lens cleared from the canvas side).
  function apply(lens) {
    state.active = lens && lens.active === 'quantize' ? 'quantize' : null;
    if (lens && lens.quantize && Array.isArray(lens.quantize.bits)) {
      state.bits = Lens.normaliseBits(lens.quantize.bits);
    }
    render();
  }

  csp.onLensApply((msg) => {
    if (msg && msg.instanceId === instanceId) apply(msg.lens);
  });

  document.getElementById('lens-close').addEventListener('click', () => csp.closeLens());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); csp.closeLens(); }
  });

  // The window follows the palette's language, like the settings popout.
  csp.snapshot()
    .then((s) => window.Iro.i18n.use(((s && s.settings) || {}).language || navigator.language || 'en'))
    .catch(() => { /* keep English */ })
    .then(() => {
      const theme = new window.Iro.ThemeRegistry();
      return theme.init(csp).catch(() => {});
    })
    .catch(() => { /* the default theme still applies */ })
    .then(render);
})();

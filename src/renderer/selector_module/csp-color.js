'use strict';

// Selector module: CSP Color — Clip Studio Paint's three selectable colours
// (foreground, background, transparent). Phase 0 renders the classic full-width
// strip; a later phase turns it into a row/column depending on its box.

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};

  /** The CSP Color settings: the strip's orientation (a setting, not a guess). */
  const settingsUI = (api, root) => {
    const row = document.createElement('label');
    row.className = 'pop-row';
    const name = document.createElement('span');
    name.textContent = window.Iro.t('module.settings.orientation');
    row.append(name);
    window.IroModelOptions.menu(row, {
      items: [['horizontal', 'module.settings.horizontal'], ['vertical', 'module.settings.vertical']]
        .map(([value, key]) => ({ value, label: window.Iro.t(key) })),
      value: api.get().orientation === 'vertical' ? 'vertical' : 'horizontal',
      onChange: (v) => api.patch({ orientation: v }),
    });
    root.append(row);
  };

  reg.modules['csp-color'] = {
    id: 'csp-color',
    name: 'CSP Color',
    version: 1,
    defaults: { orientation: 'horizontal' },
    settingsUI,
    /** Room for the three chips plus the header. */
    minSize() { return { width: 96, height: 40 }; },
    /** A locked-ratio strip (the manifest's `defaultRatio`), not a content height. */

    create(ctx) {
      const Color = window.Color;
      const clamp255 = window.Iro.clamp255;

      const slots = document.createElement('div');
      slots.className = 'slots';
      slots.setAttribute('role', 'group');
      slots.setAttribute('aria-label', 'Colour slots');

      const make = (id, label, extra) => {
        const node = document.createElement('div');
        node.id = id;
        node.className = 'slot' + (extra ? ' ' + extra : '');
        node.title = label;
        return node;
      };
      const main = make('slot-main', 'Foreground colour', '');
      const sub = make('slot-sub', 'Background colour', '');
      const transparent = make('slot-transparent', 'Transparent colour', 'slot-transparent');
      slots.append(main, sub, transparent);
      ctx.el.append(slots);

      const paint = (node, slot, isActive, label) => {
        // `slot.rgb` is the value CSP records; what we draw is how it *appears*
        // (through the proof). The recorded hex is what you would type back in,
        // so the tooltip leads with it, like the palette's hex field does.
        const stored = slot && slot.rgb ? { r: slot.rgb.r, g: slot.rgb.g, b: slot.rgb.b } : null;
        let shown = stored;
        if (stored && ctx.color.proofOn()) {
          const f = ctx.color.proof.displaySrgbFromContent([stored.r / 255, stored.g / 255, stored.b / 255]);
          shown = { r: clamp255(f[0] * 255), g: clamp255(f[1] * 255), b: clamp255(f[2] * 255) };
        }
        const storedHex = stored ? Color.rgbToHex(stored.r, stored.g, stored.b) : null;
        const shownHex = shown ? Color.rgbToHex(shown.r, shown.g, shown.b) : null;
        node.classList.toggle('active', isActive);
        node.classList.toggle('empty', !shownHex);
        node.style.background = shownHex || '';
        node.title = !shownHex
          ? `${label}: unknown`
          : storedHex && storedHex !== shownHex
            ? `${label}: ${storedHex} (shown ${shownHex})`
            : `${label}: ${shownHex}`;
      };

      const render = () => {
        const { main: m, sub: s, active } = ctx.color.slots;
        paint(main, m, active === 'main', 'Foreground');
        paint(sub, s, active === 'sub', 'Background');
        transparent.classList.toggle('active', active === 'transparent');
      };

      main.addEventListener('click', () => ctx.color.selectSlot('main'));
      sub.addEventListener('click', () => ctx.color.selectSlot('sub'));
      transparent.addEventListener('click', () => ctx.color.selectSlot('transparent'));

      slots.dataset.orientation = 'horizontal';
      const unsubscribe = ctx.color.subscribe(render);
      render();
      return {
        onSettings(settings) {
          slots.dataset.orientation = settings.orientation === 'vertical' ? 'vertical' : 'horizontal';
        },
        destroy() { unsubscribe(); },
      };
    },
  };
})();

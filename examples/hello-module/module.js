'use strict';

(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};

  reg.modules['hello-module'] = {
    id: 'hello-module',
    name: 'Hello Module',
    version: 1,
    defaults: { greeting: 'Hello' },
    autoHeight: true,
    minSize() { return { width: 160, height: 30 }; },

    settingsUI(api, root) {
      const row = document.createElement('label');
      row.className = 'pop-row';
      const name = document.createElement('span');
      name.textContent = 'Greeting';
      const box = document.createElement('input');
      box.type = 'text';
      box.value = api.get().greeting || '';
      box.addEventListener('change', () => api.patch({ greeting: box.value }));
      row.append(name, box);
      root.append(row);
    },

    create(ctx) {
      let clicks = 0;
      const el = document.createElement('div');
      el.className = 'hello-module';
      const render = () => {
        const hex = ctx.color.contentHex();
        el.textContent = `${ctx.settings.get().greeting || 'Hello'} — ${hex} (${clicks})`;
      };
      el.title = 'Click to count';
      el.addEventListener('click', () => { clicks += 1; render(); });
      ctx.el.append(el);
      const unsubscribe = ctx.color.subscribe(render);
      render();

      return {
        commands: {
          greet: () => `${ctx.settings.get().greeting || 'Hello'} from hello-module`,
          clicks: () => clicks,
        },
        onSettings() { render(); },
        destroy() { unsubscribe(); },
      };
    },
  };
})();

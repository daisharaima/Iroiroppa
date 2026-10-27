'use strict';

// The model dropdown is an in-page menu (kernel/model-options.js): a button in the
// settings row plus a grouped list rendered *after* that row. It exists because a
// native <select>'s list is an OS window outside our topmost band. These tests run the
// real file against a small DOM stub — no Electron, no jsdom.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'kernel', 'model-options.js'),
  'utf8',
);

const LABELS = {
  'settings.family.oklab': 'OKLab',
  'settings.family.cielab': 'CIELAB',
  'settings.family.helmgen': 'HelmGen',
};

class El {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.hidden = false;
    this.textContent = '';
    this.className = '';
    this.type = '';
    this.innerHTML = '';
    this.handlers = new Map();
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => {
        if (on === undefined) { if (classes.has(c)) classes.delete(c); else classes.add(c); }
        else if (on) classes.add(c);
        else classes.delete(c);
      },
      contains: (c) => classes.has(c),
    };
  }

  append(...kids) {
    for (const kid of kids) { kid.parentElement = this; this.children.push(kid); }
  }

  appendChild(kid) { this.append(kid); return kid; }

  insertBefore(kid, ref) {
    kid.parentElement = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(kid); else this.children.splice(at, 0, kid);
    return kid;
  }

  addEventListener(type, fn) { const list = this.handlers.get(type) || []; list.push(fn); this.handlers.set(type, list); }

  contains(node) {
    if (node === this) return true;
    for (const kid of this.children) if (kid.contains(node)) return true;
    return false;
  }

  scrollIntoView() {}

  getBoundingClientRect() { return { left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 }; }

  fire(type, extra = {}) {
    for (const fn of this.handlers.get(type) || []) {
      fn({ preventDefault() {}, target: this, ...extra });
    }
  }
}

/** Load the real widget file with a DOM stub. */
const load = () => {
  const doc = {
    createElement: (tag) => new El(tag),
    listeners: new Map(),
    addEventListener(type, fn) {
      const list = this.listeners.get(type) || [];
      list.push(fn);
      this.listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = this.listeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
  };
  const window = { Iro: { t: (key) => LABELS[key] || key } };
  const sandbox = { window, document: doc, console };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'model-options.js' });
  return { api: window.IroModelOptions, doc };
};

/** Load with the desktop overlay available (the real app's dropdown). */
const loadWithOverlay = () => {
  const doc = {
    createElement: (tag) => new El(tag),
    listeners: new Map(),
    addEventListener() {},
    removeEventListener() {},
  };
  const shown = [];
  const handlers = new Map();
  const overlayMenu = {
    show: (kind, trigger, spec) => { shown.push({ kind, trigger, spec }); return true; },
    onPick: (kind, fn) => { handlers.set(kind, fn); },
    close() {},
    kind: () => 'model',
  };
  const window = {
    screenX: 100,
    screenY: 200,
    Iro: { t: (key) => LABELS[key] || key, overlayMenu },
    csp: { showPaletteMenu() {} },
  };
  const sandbox = { window, document: doc, console };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'model-options.js' });
  return { api: window.IroModelOptions, doc, shown, handlers };
};

const MODELS = [
  { id: 'oklch', name: 'OKLCH', family: 'oklab' },
  { id: 'cielch', name: 'CIELCH', family: 'cielab' },
  { id: 'helmgenlch', name: 'HelmGen LCH', family: 'helmgen' },
  { id: 'okhsv', name: 'OKHSV', family: 'oklab' },
];

test('groups() orders the families OKLab, CIELAB, HelmGen and keeps within-family order', () => {
  const { api } = load();
  // The file runs in its own vm realm; copy the result before deep-comparing it.
  const groups = JSON.parse(JSON.stringify(api.groups(MODELS)));
  assert.deepStrictEqual(groups.map((g) => g.label), ['OKLab', 'CIELAB', 'HelmGen']);
  assert.deepStrictEqual(groups[0].items.map((i) => i.value), ['oklch', 'okhsv']);
  assert.deepStrictEqual(groups[1].items.map((i) => i.value), ['cielch']);
  assert.deepStrictEqual(groups[2].items.map((i) => i.value), ['helmgenlch']);
});

test('menu() puts the button in the row and the grouped list after it', () => {
  const { api } = load();
  const root = new El('div');
  const row = new El('label');
  row.parentElement = root;
  root.children.push(row);

  api.menu(row, { groups: api.groups(MODELS), value: 'oklch', onChange: () => {} });

  const wrap = row.children[0];
  assert.ok(wrap, 'the button wrap lives in the settings row');
  const btnInRow = wrap.children.find((c) => c.className.includes('menu-btn'));
  assert.ok(btnInRow, 'with a button');
  // The row is appended to its body *after* the widget is built, so the list is placed
  // on first open, right after the row.
  btnInRow.fire('click');
  const at = root.children.indexOf(row);
  const list = root.children[at + 1];
  assert.ok(list, 'the list follows the row');
  assert.strictEqual(list.className, 'menu-list');
  assert.strictEqual(list.hidden, false, 'opened by the click');
  assert.deepStrictEqual(
    list.children.map((c) => c.className),
    ['menu-group', 'menu-item', 'menu-item', 'menu-group', 'menu-item', 'menu-group', 'menu-item'],
  );
  assert.deepStrictEqual(
    list.children.filter((c) => c.className === 'menu-item').map((c) => c.dataset.value),
    ['oklch', 'okhsv', 'cielch', 'helmgenlch'],
  );
});

/** The parts a settings page ends up with: the button (inside the row) and the list. */
const parts = (root, row) => {
  const wrap = row.children[0];
  const btn = wrap.children.find((c) => c.className.includes('menu-btn'));
  const value = btn.children.find((c) => c.className === 'menu-value');
  // The list is placed on first open; open and close so the test starts from closed.
  btn.fire('click');
  btn.fire('click');
  const list = root.children[root.children.indexOf(row) + 1];
  return { btn, value, list };
};

test('a one-model family named like the family needs no heading', () => {
  const { api } = load();
  const root = new El('div');
  const row = new El('label');
  row.parentElement = root;
  root.children.push(row);
  api.menu(row, {
    groups: [{ label: 'CIELAB', items: [{ value: 'cielab', label: 'CIELAB' }] }],
    value: 'cielab',
    onChange: () => {},
  });
  const wrap = row.children[0];
  wrap.children.find((c) => c.className.includes('menu-btn')).fire('click');
  const list = root.children[root.children.indexOf(row) + 1];
  assert.deepStrictEqual(list.children.map((c) => c.className), ['menu-item']);
});

test('a pointerdown inside the list does not close it, and the pick still lands', () => {
  const { api, doc } = load();
  const root = new El('div');
  const row = new El('label');
  row.parentElement = root;
  root.children.push(row);
  const picked = [];
  api.menu(row, {
    items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    value: 'a',
    onChange: (v) => picked.push(v),
  });
  const { btn, list } = parts(root, row);
  btn.fire('click');
  const guards = doc.listeners.get('pointerdown') || [];
  assert.strictEqual(guards.length, 1);
  const item = list.children.filter((c) => c.className === 'menu-item')[1];

  // A press on an item must not count as "outside" (the list is a sibling of the row).
  guards[0]({ target: item });
  assert.strictEqual(list.hidden, false, 'still open');
  item.fire('click');
  assert.deepStrictEqual(picked, ['b']);
  assert.strictEqual(list.hidden, true);
});

test('picking an item closes the list and reports exactly one change', () => {
  const { api, doc } = load();
  const root = new El('div');
  const row = new El('label');
  row.parentElement = root;
  root.children.push(row);
  const picked = [];
  api.menu(row, {
    groups: api.groups(MODELS), value: 'oklch', onChange: (v) => picked.push(v),
  });
  const { btn, list } = parts(root, row);

  btn.fire('click');
  assert.strictEqual(list.hidden, false);
  assert.strictEqual(doc.listeners.get('pointerdown').length, 1, 'outside-click guard armed');

  list.children.filter((c) => c.className === 'menu-item')[2].fire('click');
  assert.deepStrictEqual(picked, ['cielch']);
  assert.strictEqual(list.hidden, true);
  assert.strictEqual((doc.listeners.get('pointerdown') || []).length, 0, 'outside-click guard removed');
});

test('set() shows the label and marks the active row', () => {
  const { api } = load();
  const root = new El('div');
  const row = new El('label');
  row.parentElement = root;
  root.children.push(row);
  const menu = api.menu(row, { groups: api.groups(MODELS), value: 'oklch', onChange: () => {} });
  const { value, list } = parts(root, row);
  assert.strictEqual(value.textContent, 'OKLCH');

  menu.set('cielch');
  assert.strictEqual(value.textContent, 'CIELCH');
  const active = list.children.filter((c) => c.className === 'menu-item' && c.classList.contains('active'));
  assert.deepStrictEqual(active.map((c) => c.dataset.value), ['cielch']);
});

test('with the overlay the dropdown is a desktop popup with family headings', () => {
  const { api, shown, handlers } = loadWithOverlay();
  const host = new El('div');
  const picked = [];
  const menu = api.menu(host, {
    groups: api.groups(MODELS), value: 'okhsv', onChange: (v) => picked.push(v),
  });
  const btn = menu.el.children[0];
  btn.fire('click');

  assert.strictEqual(shown.length, 1, 'one overlay menu asked for');
  assert.match(shown[0].kind, /^model:\d+$/, 'the pick is routed to this menu id');
  const items = shown[0].spec.items;
  assert.deepStrictEqual(
    [...items.filter((i) => i.kind === 'heading').map((i) => i.label)],
    ['OKLab', 'CIELAB', 'HelmGen'],
    'one heading per family, in order',
  );
  assert.ok(items.some((i) => i.id === 'okhsv'), 'every model is a row');
  assert.ok(shown[0].spec.anchor.x > 0 && shown[0].spec.anchor.y > 0, 'anchored below the button');

  handlers.get(shown[0].kind)('oklch');
  assert.deepStrictEqual(picked, ['oklch'], 'the pick reaches onChange');
  assert.strictEqual(btn.children[0].textContent, 'OKLCH');
});

test('two menus on one page route the pick to the one that was opened', () => {
  const { api, shown, handlers } = loadWithOverlay();
  const host = new El('div');
  const first = [];
  const second = [];
  const a = api.menu(host, { groups: api.groups(MODELS), value: 'oklch', onChange: (v) => first.push(v) });
  const b = api.menu(host, { groups: api.groups(MODELS), value: 'cielch', onChange: (v) => second.push(v) });
  // Both buttons exist; open the *first* one (the last-built handler used to win).
  a.el.children[0].fire('click');
  assert.strictEqual(shown.length, 1);
  const idA = shown[0].kind;
  b.el.children[0].fire('click');
  const idB = shown[1].kind;
  assert.notStrictEqual(idA, idB, 'each widget has its own menu id');
  handlers.get(idA)('okhsv');
  assert.deepStrictEqual(first, ['okhsv'], 'the first menu got its pick');
  assert.deepStrictEqual(second, [], 'the second menu did not');
  handlers.get(idB)('helmgenlch');
  assert.deepStrictEqual(second, ['helmgenlch']);
});

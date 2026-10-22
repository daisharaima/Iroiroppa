/*
 * Canonical accelerator comparison between Iroiroppa and CSP.
 *
 * CSP stores its modifiers as a Windows bitfield (Ctrl/Shift/Alt) and the key as a
 * loose string (`N`, `F12`, `DELETE`, `NUM+`). Electron accelerators use names like
 * `CommandOrControl+Shift+N`. This module normalizes both to one form so the
 * CSP Shortcuts manager can warn about a real collision instead of a spelling one.
 *
 * Loads as CommonJS in Node and as a global `IroShortcutMatch` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroShortcutMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'];
  const MOD_ALIAS = {
    ctrl: 'Ctrl', control: 'Ctrl', commandorcontrol: 'Ctrl', cmdorctrl: 'Ctrl',
    cmd: 'Super', command: 'Super', super: 'Super', meta: 'Super', win: 'Super',
    alt: 'Alt', option: 'Alt', shift: 'Shift',
  };
  const KEY_ALIAS = {
    return: 'Enter', enter: 'Enter', esc: 'Escape', escape: 'Escape',
    del: 'Delete', delete: 'Delete', ins: 'Insert', insert: 'Insert',
    backspace: 'Backspace', space: 'Space', spacebar: 'Space',
    up: 'Up', down: 'Down', left: 'Left', right: 'Right',
    pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End',
    plus: 'Plus', minus: 'Minus', equal: 'Equal', comma: 'Comma', period: 'Period',
    slash: 'Slash', semicolon: 'Semicolon', quote: 'Quote',
    bracketleft: 'BracketLeft', bracketright: 'BracketRight', backslash: 'Backslash',
    backquote: 'Backquote', tab: 'Tab', capslock: 'CapsLock', numlock: 'NumLock',
    scrolllock: 'ScrollLock', printscreen: 'PrintScreen', pause: 'Pause',
    numplus: 'NumPlus', numminus: 'NumMinus', nummultiply: 'NumMultiply', numdivide: 'NumDivide',
    'num+': 'NumPlus', 'num-': 'NumMinus', 'num*': 'NumMultiply', 'num/': 'NumDivide',
  };
  for (let i = 0; i <= 9; i++) KEY_ALIAS[`num${i}`] = `Num${i}`;
  for (let i = 1; i <= 24; i++) KEY_ALIAS[`f${i}`] = `F${i}`;
  const PUNCT = {
    '+': 'Plus', '-': 'Minus', '=': 'Equal', ',': 'Comma', '.': 'Period',
    '/': 'Slash', ';': 'Semicolon', ':': 'Colon', "'": 'Quote', '"': 'Quote',
    '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '`': 'Backquote',
    '@': 'At', '!': 'Exclamation', '#': 'Hash', '$': 'Dollar', '%': 'Percent',
    '^': 'Caret', '&': 'Ampersand', '*': 'Asterisk', '(': 'ParenLeft', ')': 'ParenRight',
    '_': 'Underscore',
  };

  function keyName(raw) {
    const key = String(raw == null ? '' : raw).trim();
    if (!key || key.toUpperCase() === 'NULL') return '';
    const lower = key.toLowerCase();
    if (KEY_ALIAS[lower]) return KEY_ALIAS[lower];
    if (PUNCT[key]) return PUNCT[key];
    if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
    if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  /** Normalize an Electron accelerator or a CSP `describeAccel()` string. */
  function normalizeAccel(accel) {
    // `NUM+` and `NUM-` are single keys, not a separator plus an empty part.
    const source = String(accel == null ? '' : accel)
      .replace(/NUM\+/gi, 'NUMPlus')
      .replace(/NUM-/gi, 'NUMMinus')
      .replace(/NUM\*/gi, 'NUMMultiply')
      .replace(/NUM\//gi, 'NUMDivide');
    const parts = source.split('+').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return '';
    const key = keyName(parts.pop());
    if (!key) return '';
    const mods = new Set();
    for (const part of parts) {
      const m = MOD_ALIAS[part.toLowerCase()];
      if (m) mods.add(m);
    }
    const ordered = MOD_ORDER.filter((m) => mods.has(m));
    return [...ordered, key].join('+');
  }

  /**
   * @param {Array<{key:string, label:string, accel:string}>} bindings
   * @param {Array<{command:string, accel:string}>} commands
   * @param {Array<{name:string, key:string}>} tools
   * @returns {Array<{key:string,label:string,accel:string,cspLabel:string}>}
   */
  function findConflicts(bindings, commands, tools) {
    const csp = new Map();
    for (const c of commands || []) {
      const n = normalizeAccel(c.accel);
      if (n && !csp.has(n)) csp.set(n, c.command || 'CSP command');
    }
    for (const t of tools || []) {
      const n = normalizeAccel(t.key);
      if (n && !csp.has(n)) csp.set(n, `Tool: ${t.name || ''}`);
    }
    const out = [];
    for (const b of bindings || []) {
      const n = normalizeAccel(b.accel);
      if (n && csp.has(n)) out.push({ ...b, accel: n, cspLabel: csp.get(n) });
    }
    return out;
  }

  return { normalizeAccel, keyName, findConflicts };
});

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
  // Windows virtual-key codes for the keys a *hold* shortcut can own. A hold
  // binding has to be registered by the PowerShell helper (RegisterHotKey) rather
  // than Electron's globalShortcut, because only the helper can see the release.
  // Punctuation is included for completeness; the settings capture only offers
  // the keys it can name.
  const VK = {
    Backspace: 0x08, Tab: 0x09, Enter: 0x0d, Pause: 0x13, CapsLock: 0x14,
    Escape: 0x1b, Space: 0x20, PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24,
    Left: 0x25, Up: 0x26, Right: 0x27, Down: 0x28, PrintScreen: 0x2c, Insert: 0x2d, Delete: 0x2e,
    Num0: 0x60, Num1: 0x61, Num2: 0x62, Num3: 0x63, Num4: 0x64,
    Num5: 0x65, Num6: 0x66, Num7: 0x67, Num8: 0x68, Num9: 0x69,
    NumMultiply: 0x6a, NumPlus: 0x6b, NumMinus: 0x6d, NumDivide: 0x6f,
    Semicolon: 0xba, Equal: 0xbb, Plus: 0xbb, Comma: 0xbc, Minus: 0xbd,
    Period: 0xbe, Slash: 0xbf, Backquote: 0xc0, BracketLeft: 0xdb, Backslash: 0xdc,
    BracketRight: 0xdd, Quote: 0xde, NumLock: 0x90, ScrollLock: 0x91,
  };
  for (let i = 65; i <= 90; i += 1) VK[String.fromCharCode(i)] = i;
  for (let i = 0; i <= 9; i += 1) VK[String(i)] = 48 + i;
  for (let i = 1; i <= 24; i += 1) VK[`F${i}`] = 111 + i;
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

  /**
   * An accelerator as the pieces the helpers need: virtual-key code and modifier
   * flags. `ok` is true for a chord `globalShortcut`/`RegisterHotKey` can own;
   * `bare` marks a modifier-less key and `hook` a bare key that must use the
   * keyboard-hook path instead (a bare letter would be swallowed system-wide).
   * @returns {{ok:boolean, bare:boolean, hook:boolean, accel:string, key:string,
   *            vk:number|null, ctrl:boolean, alt:boolean, shift:boolean, super:boolean}}
   */
  function parseAccelerator(accel) {
    const normalized = normalizeAccel(accel);
    const parts = normalized.split('+').filter(Boolean);
    const key = parts.pop() || '';
    const out = {
      ok: false, bare: false, hook: false, accel: normalized, key,
      vk: VK[key] != null ? VK[key] : null,
      ctrl: parts.includes('Ctrl'), alt: parts.includes('Alt'),
      shift: parts.includes('Shift'), super: parts.includes('Super'),
    };
    const hasMod = out.ctrl || out.alt || out.shift || out.super;
    out.bare = Boolean(out.vk && !hasMod);
    const fKey = /^F\d{1,2}$/.test(key);
    // A bare key is only safe through the keyboard hook; F-keys have no typing
    // downside and stay on globalShortcut like every chord.
    out.hook = Boolean(out.bare && !fKey);
    out.ok = Boolean(out.vk && (hasMod || fKey));
    return out;
  }

  /**
   * Is this a binding Iroiroppa may own? `allowBare` is only used for the
   * General/Palette reveal keys; module command keys stay modifier-only.
   */
  function validAccelerator(accel, { allowBare = false } = {}) {
    if (!accel) return true;
    const parsed = parseAccelerator(accel);
    return parsed.ok || (allowBare && parsed.bare);
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

  return {
    VK, normalizeAccel, keyName, parseAccelerator, validAccelerator, findConflicts,
  };
});

'use strict';

/** Different spellings of one physical key, as CSP and Electron name them. */
const KEY_ALIASES = {
  space: ' ', spacebar: ' ', ' ': ' ',
  del: 'delete', delete: 'delete', ins: 'insert', insert: 'insert',
  esc: 'escape', escape: 'escape', return: 'enter', enter: 'enter',
  up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright',
  pgup: 'pageup', pgdn: 'pagedown', pagedown: 'pagedown', pageup: 'pageup',
  home: 'home', end: 'end', tab: 'tab', backspace: 'backspace',
  numplus: 'numplus', numminus: 'numminus', nummultiply: 'nummultiply', numdivide: 'numdivide',
};

/**
 * Split an accelerator into its modifiers and key, comparable across the two
 * vocabularies: CSP writes `Ctrl+Shift+G`, Electron writes `ctrl+shift+g`.
 */
function parseAccel(text) {
  const parts = String(text == null ? '' : text).split('+').map((p) => p.trim()).filter(Boolean);
  const mods = { ctrl: false, shift: false, alt: false, meta: false };
  let key = '';
  for (const part of parts) {
    const low = part.toLowerCase();
    if (low === 'ctrl' || low === 'control') mods.ctrl = true;
    else if (low === 'shift') mods.shift = true;
    else if (low === 'alt') mods.alt = true;
    else if (low === 'meta' || low === 'super' || low === 'cmd' || low === 'command' || low === 'win') mods.meta = true;
    else key = KEY_ALIASES[low] || low;
  }
  return { ...mods, key };
}

/** Are these the same chord? An empty key never matches anything. */
function sameAccel(a, b) {
  const x = parseAccel(a);
  const y = parseAccel(b);
  return x.key !== '' && x.key === y.key
    && x.ctrl === y.ctrl && x.shift === y.shift && x.alt === y.alt && x.meta === y.meta;
}

/**
 * The CSP owner of this accelerator, as `{ label, kind }`, or null.
 *
 * `list` is `{ commands, tools }` from `csp-shortcuts.js#list`: `commands` carry
 * `accels` (menu shortcuts), `tools` carry a bare `key` (a tool's own letter).
 */
function cspOwner(accel, list) {
  if (!accel) return null;
  const commands = (list && list.commands) || [];
  for (const entry of commands) {
    for (const other of entry.accels || []) {
      if (sameAccel(other, accel)) return { label: entry.label || entry.command || accel, kind: 'command' };
    }
  }
  const tools = (list && list.tools) || [];
  for (const tool of tools) {
    if (tool && tool.key && sameAccel(tool.key, accel)) {
      return { label: tool.name || accel, kind: tool.kind === 'brush' ? 'brush' : 'tool' };
    }
  }
  return null;
}

module.exports = { KEY_ALIASES, parseAccel, sameAccel, cspOwner };

'use strict';

const COMMAND = 'advancedcommand';
const ITEM_TYPE = 'Command';

const MAX_NAMES = 64;

/** One `UpdateTargetItemIDs` entry for a command name. */
function itemId(name) {
  return {
    ItemIDType: ITEM_TYPE,
    ItemIDCommandType: COMMAND,
    ItemIDCommandName: String(name || ''),
    ItemIDToolUuid: '',
  };
}

/** Clean a name list: strings only, trimmed, de-duplicated, capped. */
function cleanNames(names) {
  if (!Array.isArray(names)) return [];
  const out = [];
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (!name || out.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_NAMES) break;
  }
  return out;
}

/** The `SyncQuickAccessUIState` detail for a set of command names. */
function readDetail(names) {
  return { UpdateTargetSetIndex: 0, UpdateTargetItemIDs: cleanNames(names).map(itemId) };
}

/** The `DoQuickAccess` detail that clicks one command. */
function clickDetail(name) {
  return { ItemType: ITEM_TYPE, ItemCommandType: COMMAND, ItemCommandName: String(name || '') };
}

/** The names a reply lists under one key, tolerating both item shapes. */
function namesFrom(list, key) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue;
    const name = item[key] || item.ItemIDCommandName || item.ItemCommandName;
    if (typeof name === 'string' && name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Parse a `SyncQuickAccessUIState` reply into `{ on, disabled }`.
 * `detail` is normally the parsed object; a JSON string is accepted too, because
 * a frame whose detail the packet parser gave up on still reaches us as text.
 * `undefined`/`null` yields empty lists (the caller treats that as "no answer").
 */
function parseState(detail) {
  let value = detail;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return { on: [], disabled: [] }; }
  }
  if (!value || typeof value !== 'object') return { on: [], disabled: [] };
  return {
    on: namesFrom(value.CheckedItemIDs, 'ItemIDCommandName'),
    disabled: namesFrom(value.DisabledItemIDs, 'ItemIDCommandName'),
  };
}

module.exports = { MAX_NAMES, ITEM_TYPE, COMMAND, itemId, cleanNames, readDetail, clickDetail, parseState };

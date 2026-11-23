'use strict';

const Drop = require('../shared/drop-resolve');

const DEFAULTS = {
  intervalMs: 16,
  maxMs: 30000,
  stallMs: 2500,
};

function createDragSession(options) {
  const o = options || {};
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const cursor = o.cursor;
  const getPanes = o.getPanes;
  const resolve = typeof o.resolve === 'function' ? o.resolve : Drop.resolveDrop;
  const showRaw = typeof o.show === 'function' ? o.show : () => {};
  /** The overlay is best-effort: a drawing failure must never end the drag. It did once — an
   *  undefined helper in main's `show` took the whole app down on the first pointerdown. */
  const show = (state) => { try { showRaw(state); } catch {  } };
  const hide = typeof o.hide === 'function' ? o.hide : () => {};
  const dispatch = o.dispatch;
  const intervalMs = Number.isFinite(o.intervalMs) ? o.intervalMs : DEFAULTS.intervalMs;
  const maxMs = Number.isFinite(o.maxMs) ? o.maxMs : DEFAULTS.maxMs;
  const stallMs = Number.isFinite(o.stallMs) ? o.stallMs : DEFAULTS.stallMs;
  const onEnd = typeof o.onEnd === 'function' ? o.onEnd : () => {};

  const moveWindows = typeof o.moveWindows === 'function' ? o.moveWindows : () => {};
  const settleWindows = typeof o.settleWindows === 'function' ? o.settleWindows : () => ({ ok: false });

  const deferPaletteMerge = o.deferPaletteMerge === true;
  const restoreWindows = typeof o.restoreWindows === 'function' ? o.restoreWindows : () => {};
  const setTimer = o.setInterval || setInterval;
  const clearTimer = o.clearInterval || clearInterval;

  let current = null;
  let timer = null;
  let seq = 0;

  if (typeof cursor !== 'function' || typeof getPanes !== 'function' || typeof dispatch !== 'function') {
    throw new Error('createDragSession needs cursor, getPanes and dispatch');
  }

  function active() {
    return Boolean(current);
  }

  function planAt(point) {

    return resolve({ point, panes: getPanes(current ? current.payload : null) });
  }

  function paint(point, plan) {

    const text = current.payload.text || '';
    show({
      text,
      hint: Boolean(current.payload.hint),
      paletteId: plan && plan.paletteId ? plan.paletteId : null,
      x: point.x,
      y: point.y,
      line: plan && plan.line ? plan.line : null,
    });
  }

  /** One poll tick: follow the cursor and re-resolve. Exported for tests. */
  function update() {
    if (!current) return null;
    const point = cursor();
    if (!point) return null;
    const moved = !current.lastPoint || point.x !== current.lastPoint.x || point.y !== current.lastPoint.y;
    if (moved) current.lastMoveAt = now();
    current.lastPoint = point;

    const limit = current.kind === 'palette' ? Math.min(stallMs, 2000) : stallMs;
    if (now() - (current.lastMoveAt || current.startedAt) > limit) {
      cancel();
      return null;
    }
    if (now() - current.startedAt > maxMs) {
      cancel();
      return null;
    }
    if (current.kind === 'palette') {

      const origin = current.origin || point;
      moveWindows(current.payload.members, point.x - origin.x, point.y - origin.y);
      const plan = planAt(point);
      current.plan = plan;
      paint(point, plan);
      return plan;
    }
    const plan = planAt(point);
    current.plan = plan;
    paint(point, plan);
    return plan;
  }

  /**
   * Start a drag. `payload` is
   *   { sourcePaletteId, items: [instanceId], grouping?: 'flat'|'columns',
   *     text?, hint?, width? }
   */
  function begin(payload) {
    if (current) cancel();

    const kind = payload && payload.kind === 'palette' ? 'palette' : 'modules';
    const items = Array.isArray(payload && payload.items) ? payload.items.filter((id) => typeof id === 'string') : [];
    const members = Array.isArray(payload && payload.members)
      ? payload.members.filter((m) => m && typeof m.paletteId === 'string' && Number.isFinite(m.x) && Number.isFinite(m.y))
      : [];
    if (kind === 'modules' && !items.length) return { ok: false, error: 'no-items' };
    if (kind === 'palette' && !members.length) return { ok: false, error: 'no-members' };
    seq += 1;
    current = {
      dragId: `drag_${seq}`,
      kind,
      origin: cursor(),
      payload: {
        kind,
        sourcePaletteId: payload.sourcePaletteId || null,
        items,
        members,
        grouping: payload.grouping === 'columns' ? 'columns' : 'flat',
        text: payload.text || '',
        hint: Boolean(payload.hint),
        width: Number.isFinite(payload.width) ? payload.width : null,
        height: Number.isFinite(payload.height) ? payload.height : null,

        itemSize: payload.itemSize && typeof payload.itemSize === 'object'
          ? { width: Number(payload.itemSize.width) || 0, height: Number(payload.itemSize.height) || 0 }
          : null,
      },
      startedAt: now(),
      plan: null,
    };
    const point = cursor();
    if (point) {
      current.plan = kind === 'modules' ? planAt(point) : null;
      paint(point, current.plan);
    }
    timer = setTimer(update, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return { ok: true, dragId: current.dragId };
  }

  function stop() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    hide();

    onEnd();
  }

  /**
   * Finish the drag at the current cursor position. The target is resolved *now*,
   * not taken from the last tick, so a window that moved under the pointer cannot
   * commit somewhere stale.
   */
  function drop() {
    if (!current) return { ok: false, error: 'no-drag' };
    const payload = current.payload;
    const point = cursor();

    if (current.kind === 'palette') {
      const origin = current.origin || point;

      const plan = planAt(point);
      stop();
      current = null;
      if (!point) return { ok: false, error: 'no-point' };
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;

      if (plan && (plan.kind === 'column' || plan.kind === 'outer')
        && plan.paletteId && payload.sourcePaletteId && plan.paletteId !== payload.sourcePaletteId) {
        const target = plan.kind === 'column'
          ? { kind: 'column', paletteId: plan.paletteId, columnId: plan.columnId, index: plan.index }
          : { kind: 'outer', paletteId: plan.paletteId, side: plan.side };
        if (deferPaletteMerge) {
          return {
            ok: true,
            pendingMerge: {
              payload: { ...payload },
              plan,
              target,
            },
          };
        }
        const out = dispatch({
          type: 'layout.place',
          sourcePaletteId: payload.sourcePaletteId,
          items: payload.items,
          grouping: payload.grouping,
          target,

          grown: payload.itemSize || undefined,
        });
        return { ok: Boolean(out && out.ok !== false), docked: plan.paletteId, plan };
      }

      return settleWindows(payload, dx, dy);
    }
    stop();
    current = null;
    if (!point) return { ok: false, error: 'no-point' };
    const plan = planAt(point);
    if (!plan) return { ok: false, error: 'no-plan' };
    const target = Drop.toPlaceTarget(plan);
    if (!target) return { ok: false, error: 'no-target' };

    if (target.kind === 'desktop') target.pos = { x: Math.round(point.x), y: Math.round(point.y) };
    const intent = {
      type: 'layout.place',
      sourcePaletteId: payload.sourcePaletteId,
      items: payload.items,
      grouping: payload.grouping,
      target,
    };
    if (payload.width != null) intent.width = payload.width;

    const grown = {};
    if (Number.isFinite(payload.width)) grown.width = payload.width;
    if (Number.isFinite(payload.height)) grown.height = payload.height;
    if (grown.width != null || grown.height != null) intent.grown = grown;
    const result = dispatch(intent);
    return { ok: Boolean(result && result.ok), error: result && result.error, plan, target, result };
  }

  function cancel() {
    if (!current) return false;

    if (current.kind === 'palette' && current.payload) restoreWindows(current.payload.members);
    stop();
    current = null;
    return true;
  }

  function state() {
    return current ? { dragId: current.dragId, payload: { ...current.payload }, plan: current.plan } : null;
  }

  return { begin, update, drop, cancel, active, state, intervalMs };
}

module.exports = { createDragSession, DEFAULTS };

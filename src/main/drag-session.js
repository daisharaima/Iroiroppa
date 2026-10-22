'use strict';

/*
 * The drag session, owned by main (docs/LAYOUT.md, V4).
 *
 * The old drag was a state machine spread across two processes and held together
 * by wall-clock timers in three files (`lastFollowAt`, the dock arm, settle
 * checks, `_resizeGraceUntil`, the edge hints). This owns it instead: main polls
 * the cursor, resolves with the one pure resolver, draws the one overlay, and
 * commits the same plan it drew — so a lost message can never lose a module.
 *
 * Everything it touches is injected (cursor, panes, resolve, overlay, dispatch,
 * timers), so the whole thing is testable without Electron or a display.
 */

const Drop = require('../shared/drop-resolve');

const DEFAULTS = {
  intervalMs: 16,
  maxMs: 30000, // a drag that never ends must not poll forever
  stallMs: 2500, // …and neither must one nobody is holding any more
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
  const show = (state) => { try { showRaw(state); } catch { /* the chip is optional */ } };
  const hide = typeof o.hide === 'function' ? o.hide : () => {};
  const dispatch = o.dispatch;
  const intervalMs = Number.isFinite(o.intervalMs) ? o.intervalMs : DEFAULTS.intervalMs;
  const maxMs = Number.isFinite(o.maxMs) ? o.maxMs : DEFAULTS.maxMs;
  const stallMs = Number.isFinite(o.stallMs) ? o.stallMs : DEFAULTS.stallMs;
  const onEnd = typeof o.onEnd === 'function' ? o.onEnd : () => {};
  // A `palette` drag moves windows rather than modules: main moves them while the pointer moves
  // and settles them on release (commit the position, then join the nearest edge or come free).
  const moveWindows = typeof o.moveWindows === 'function' ? o.moveWindows : () => {};
  const settleWindows = typeof o.settleWindows === 'function' ? o.settleWindows : () => ({ ok: false });
  const setTimer = o.setInterval || setInterval;
  const clearTimer = o.clearInterval || clearInterval;

  let current = null;      // { dragId, payload, startedAt, plan }
  let timer = null;
  let seq = 0;

  if (typeof cursor !== 'function' || typeof getPanes !== 'function' || typeof dispatch !== 'function') {
    throw new Error('createDragSession needs cursor, getPanes and dispatch');
  }

  function active() {
    return Boolean(current);
  }

  function planAt(point) {
    // The window the drag started in is sorted last by the caller (see `paneList`), so a
    // bystander it merely overlaps wins the lookup instead of swallowing the drop. That
    // is why a module used to dock only when the destination happened to be the palette.
    return resolve({ point, panes: getPanes(current ? current.payload : null) });
  }

  function paint(point, plan) {
    // The chip follows the pointer for the whole drag, including while the pointer is still inside
    // the source palette: it names what is being carried, and blanking it there only made the drag
    // look like the module had vanished. (The *card* still stays visible until the pointer leaves —
    // that part is the renderer's, and it is a different question from what the chip says.)
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
    // A drag the user is holding moves the cursor; one nobody holds does not. A palette drag
    // gives up sooner: its windows are invisible while it lasts, so a lost release must not
    // leave the screen looking empty.
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
      // A window drag moves the windows with the pointer — visibly. Hiding them and drawing an
      // outline instead was the wrong trade: the palette appeared not to move at all. The line
      // still resolves, so a release over another palette previews the dock it will perform.
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
    if (current) cancel(); // a second begin supersedes the first
    // Two kinds of drag share this session. `modules` moves instances between palettes and
    // commits a `layout.place`; `palette` moves whole windows (a snap group) and commits
    // `palette.setBounds` for each member, so the thing being dragged can hide and only its
    // name chip is seen (docs/LAYOUT.md, "Snap zones").
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
      origin: cursor(), // where the pointer was, so members keep their relative offsets
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
        // A whole-palette drag carries the dragged window's own size, for the destination's fit.
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
    // Every end (a drop, a cancel, a watchdog) lands here, so this is where main clears
    // whatever a drag left behind — the floats that hid themselves for a dock.
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
    // A window drag commits positions, not a placement: every member moves by the pointer's
    // total offset from where the drag began, so the group keeps its shape.
    if (current.kind === 'palette') {
      const origin = current.origin || point;
      // Resolve before the session is cleared, so the source palette is still known to the
      // resolver (the caller sorts it last, so it cannot win over a real destination).
      const plan = planAt(point);
      stop();
      current = null;
      if (!point) return { ok: false, error: 'no-point' };
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      // Released over another palette: its contents move there. That is the dock, and the
      // indicator showed exactly this while the pointer was over it.
      if (plan && (plan.kind === 'column' || plan.kind === 'outer')
        && plan.paletteId && payload.sourcePaletteId && plan.paletteId !== payload.sourcePaletteId) {
        const target = plan.kind === 'column'
          ? { kind: 'column', paletteId: plan.paletteId, columnId: plan.columnId, index: plan.index }
          : { kind: 'outer', paletteId: plan.paletteId, side: plan.side };
        const out = dispatch({
          type: 'layout.place',
          sourcePaletteId: payload.sourcePaletteId,
          items: payload.items,
          grouping: payload.grouping,
          target,
          // A docked palette carries its own window size: the destination grows by its width
          // (a column at a vertical edge) or its height (rows at a horizontal one).
          grown: payload.itemSize || undefined,
        });
        return { ok: Boolean(out && out.ok !== false), docked: plan.paletteId, plan };
      }
      // Otherwise it is a move: main commits the position and then joins the nearest palette
      // edge — or comes free — because proximity is the whole snap rule now.
      return settleWindows(payload, dx, dy);
    }
    stop();
    current = null;
    if (!point) return { ok: false, error: 'no-point' };
    const plan = planAt(point);
    if (!plan) return { ok: false, error: 'no-plan' };
    const target = Drop.toPlaceTarget(plan);
    if (!target) return { ok: false, error: 'no-target' };
    // A brand-new window lands where it was dropped. Positions are screen DIP, the
    // same space the cursor is in, and without this the window was placed by main's
    // fallback — always "just right of the palette", wherever the pointer was.
    if (target.kind === 'desktop') target.pos = { x: Math.round(point.x), y: Math.round(point.y) };
    const intent = {
      type: 'layout.place',
      sourcePaletteId: payload.sourcePaletteId,
      items: payload.items,
      grouping: payload.grouping,
      target,
    };
    if (payload.width != null) intent.width = payload.width;
    // The size the destination should grow by: the drawn item, so the rule (width for a new
    // column, height for a row) lives in one place — see `fitPane` in main.
    const grown = {};
    if (Number.isFinite(payload.width)) grown.width = payload.width;
    if (Number.isFinite(payload.height)) grown.height = payload.height;
    if (grown.width != null || grown.height != null) intent.grown = grown;
    const result = dispatch(intent);
    return { ok: Boolean(result && result.ok), error: result && result.error, plan, target, result };
  }

  function cancel() {
    if (!current) return false;
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

'use strict';

(function () {
  const captures = new Set();

  function capture(canvas, pointerId) {
    if (!canvas || !Number.isFinite(pointerId)) return;
    captures.add({ canvas, pointerId });
    try { canvas.setPointerCapture(pointerId); } catch {  }
  }

  function release(canvas, pointerId) {
    for (const entry of [...captures]) {
      if (entry.canvas === canvas && (pointerId == null || entry.pointerId === pointerId)) {
        try { entry.canvas.releasePointerCapture(entry.pointerId); } catch {  }
        captures.delete(entry);
      }
    }
  }

  function releaseAll() {
    for (const entry of captures) {
      try { entry.canvas.releasePointerCapture(entry.pointerId); } catch {  }
    }
    captures.clear();
  }

  /** A short label for an event target, for the `--trace-input` log. */
  function describe(target) {
    if (!target) return 'none';
    if (target === window) return 'window';
    if (target === document) return 'document';
    if (!target.tagName) return 'node';
    const id = target.id ? '#' + target.id : '';
    const cls = typeof target.className === 'string' && target.className.trim()
      ? '.' + target.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    return (target.tagName.toLowerCase() + id + cls).slice(0, 90);
  }

  /**
   * Record what this page actually receives (`--trace-input`, docs/DEV.md). A page
   * that paints but takes no clicks needs the answer to "did the press reach the
   * DOM at all?" before anyone can fix it: hover proves only moves arrive.
   * One line per event; moves are throttled to 5/s.
   */
  function trace(csp) {
    if (!csp || typeof csp.inputTrace !== 'function') return;
    const send = (type, ev) => {
      csp.inputTrace({
        type,
        target: describe(ev.target),
        button: ev.button,
        buttons: ev.buttons,
        pointerId: ev.pointerId,
        pointerType: ev.pointerType || '',
        x: Math.round(ev.clientX || 0),
        y: Math.round(ev.clientY || 0),
      });
    };
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click']) {
      window.addEventListener(type, (ev) => send(type, ev), true);
    }
    let lastMove = 0;
    window.addEventListener('pointermove', (ev) => {
      const now = performance.now();
      if (now - lastMove < 200) return;
      lastMove = now;
      send('pointermove', ev);
    }, true);

    requestAnimationFrame(() => {
      const x = Math.round(window.innerWidth / 2);
      const y = Math.round(window.innerHeight / 2);
      const hit = document.elementFromPoint(x, y);
      csp.inputTrace({ type: 'probe', target: describe(hit), x, y });
    });
  }

  window.IroInputReset = { capture, release, releaseAll, trace };
})();

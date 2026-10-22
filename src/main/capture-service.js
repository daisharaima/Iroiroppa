'use strict';

// The window-capture *channel*: enumerate real windows
// so a module can pick one and read its pixels. This is separate from the QR scan
// (capture.js) — that is a one-shot screenshot for pairing; this is a live source
// a renderer holds.
//
// Electron's desktopCapturer is main-only under context isolation: main lists the
// sources (id + name), and the renderer opens the chosen one with getUserMedia
// using its id. `getSources` is injected so the service is Electron-free and
// testable; `--capture-fake <name>` lists one synthetic source, so a `--shot` can
// render the picker without a desktop.

function createCaptureService({ getSources, fake } = {}) {
  const listeners = new Set();
  let lastKey = null;

  const synthetic = () => (fake ? [{ id: 'fake:0', name: String(fake), kind: 'window' }] : []);

  /** The capturable windows, `[{ id, name, kind }]`; never throws. */
  async function sources() {
    if (fake) {
      const list = synthetic();
      if (list.map((s) => s.id).join('\u0000') !== lastKey) {
        lastKey = list.map((s) => s.id).join('\u0000');
        emit(list);
      }
      return list;
    }
    if (typeof getSources !== 'function') return [];
    let raw = [];
    try {
      raw = await getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
    } catch {
      raw = [];
    }
    const list = (raw || [])
      .filter((s) => s && s.id)
      .map((s) => ({ id: String(s.id), name: s.name || 'Window', kind: 'window' }));
    const key = list.map((s) => s.id).join('\u0000');
    if (key !== lastKey) {
      lastKey = key;
      emit(list);
    }
    return list;
  }

  function emit(list) {
    for (const fn of listeners) { try { fn(list); } catch { /* keep going */ } }
  }

  /** Called when the source list changes (a window opened/closed). */
  function on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { sources, on };
}

module.exports = { createCaptureService };

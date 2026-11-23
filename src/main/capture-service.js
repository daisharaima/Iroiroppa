'use strict';

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
    for (const fn of listeners) { try { fn(list); } catch {  } }
  }

  /** Called when the source list changes (a window opened/closed). */
  function on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { sources, on };
}

module.exports = { createCaptureService };

'use strict';

// Frame-gap recorder for a gesture (docs/PERF.md, `--perf-gaps`).
//
// It answers one question the other tools cannot: while the user drags a control,
// does the palette keep painting every frame, or does a heavy panel block the main
// thread? A gap above the refresh interval is a visible stutter; a run of them is a
// stall.
//
// The recorder is passive: it samples `requestAnimationFrame` timestamps, keeps the
// deltas of the current gesture, and on release reports the distribution to main,
// which appends one line to `perf-trace.log`. Nothing is drawn or changed.

(function installPerfGaps() {
  const bridge = window.csp;
  if (!bridge || !bridge.perfGaps || !bridge.perfGapsReport) return;

  const MAX_SAMPLES = 4000;
  let sampling = false;
  let samples = [];
  let last = 0;
  let frame = 0;
  // Long tasks (a single callback over 50 ms) tell a different story from a burst of
  // short frames: one long task is a blocking function, many short ones are death by
  // a thousand layout/GC cuts. Recorded so the fix targets the right thing.
  let longTasks = [];

  if (typeof PerformanceObserver === 'function') {
    try {
      new PerformanceObserver((list) => {
        if (!sampling) return;
        for (const entry of list.getEntries()) {
          longTasks.push({
            at: Math.round(entry.startTime - gestureStart),
            ms: Math.round(entry.duration * 10) / 10,
          });
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* the entry type is optional */ }
  }
  let gestureStart = 0;
  let workerAtStart = null;

  function tick(now) {
    if (!sampling) return;
    if (last) {
      samples.push(now - last);
      if (samples.length > MAX_SAMPLES) samples.shift();
    }
    last = now;
    frame = requestAnimationFrame(tick);
    return frame;
  }

  function percentile(sorted, fraction) {
    if (!sorted.length) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round(sorted.length * fraction) - 1));
    return sorted[index];
  }

  function begin(label) {
    if (sampling) return;
    sampling = true;
    samples = [];
    longTasks = [];
    gestureStart = performance.now();
    workerAtStart = window.IroPlaneWorker && window.IroPlaneWorker.stats ? window.IroPlaneWorker.stats() : null;
    last = 0;
    requestAnimationFrame(tick);
    window.__perfGesture = label || 'gesture';
  }

  function end(extra = {}) {
    if (!sampling) return null;
    sampling = false;
    if (frame) cancelAnimationFrame(frame);
    const sorted = samples.slice().sort((a, b) => a - b);
    const summary = {
      gesture: window.__perfGesture || 'gesture',
      frames: samples.length,
      spanMs: Math.round(samples.reduce((sum, value) => sum + value, 0)),
      p50: Math.round(percentile(sorted, 0.5) * 100) / 100,
      p95: Math.round(percentile(sorted, 0.95) * 100) / 100,
      p99: Math.round(percentile(sorted, 0.99) * 100) / 100,
      max: Math.round((sorted[sorted.length - 1] || 0) * 100) / 100,
      over25: samples.filter((value) => value > 25).length,
      over50: samples.filter((value) => value > 50).length,
      longTasks: longTasks.length,
      longestTask: longTasks.reduce((max, task) => Math.max(max, task.ms), 0),
      blockingMs: Math.round(longTasks.reduce((sum, task) => sum + Math.max(0, task.ms - 50), 0)),
      worst: longTasks.slice().sort((a, b) => b.ms - a.ms).slice(0, 3),
      planeDbg: window.__planeDbg || null,
      plotDbg: window.__plotDbg || null,
      planeWorker: window.IroPlaneWorker && window.IroPlaneWorker.stats
        ? (() => { const now = window.IroPlaneWorker.stats(); const start = workerAtStart || { started: 0, completed: 0, totalMs: 0 }; return { jobs: now.started - start.started, done: now.completed - start.completed, ms: now.totalMs - start.totalMs, failed: now.failed, error: now.error || '' }; })()
        : null,
      ...extra,
    };
    samples = [];
    longTasks = [];
    last = 0;
    bridge.perfGapsReport(summary);
    return summary;
  }

  // A gesture is a press on the palette's own surface: that is where a drag sends a
  // colour write per move and where a heavy panel would stall the paint.
  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    begin(event.target && event.target.id ? event.target.id : 'palette');
  }, true);

  window.addEventListener('pointerup', () => end(), true);
  window.addEventListener('pointercancel', () => end({ cancelled: true }), true);

  window.Iro = window.Iro || {};
  window.Iro.perfGaps = { begin, end, sampling: () => sampling };
})();
